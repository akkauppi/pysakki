import { GraphQLClient, gql } from "graphql-request";
import { filterBoardableDepartures } from "./departureFilter";

const GRAPHQL_URL =
  import.meta.env.VITE_DIGITRANSIT_GRAPHQL_URL ??
  "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";

const GEOCODING_URL =
  import.meta.env.VITE_DIGITRANSIT_GEOCODING_URL ??
  "https://api.digitransit.fi/geocoding/v1/search";

const client = new GraphQLClient(GRAPHQL_URL, {
  headers: {
    ...(import.meta.env.VITE_DIGITRANSIT_API_KEY
      ? {
          "digitransit-subscription-key": import.meta.env.VITE_DIGITRANSIT_API_KEY,
        }
      : {}),
  },
});

const stopQuery = gql`
  query StopDetails($id: String!, $numberOfDepartures: Int!) {
    stop(id: $id) {
      gtfsId
      name
      code
      desc
      lat
      lon
      vehicleMode
      stoptimesWithoutPatterns(numberOfDepartures: $numberOfDepartures) {
        scheduledArrival
        realtimeArrival
        scheduledDeparture
        realtimeDeparture
        serviceDay
        realtime
        headsign
        pickupType
        dropoffType
        stopPositionInPattern
        trip {
          route {
            shortName
            longName
            mode
          }
        }
      }
    }
  }
`;

const nearbyTramStopsQuery = gql`
  query NearbyTramStops($lat: Float!, $lon: Float!, $maxDistance: Int!, $maxResults: Int!) {
    nearest(
      lat: $lat
      lon: $lon
      maxDistance: $maxDistance
      maxResults: $maxResults
      filterByPlaceTypes: [STOP]
      filterByModes: [TRAM]
    ) {
      edges {
        node {
          distance
          place {
            __typename
            ... on Stop {
              gtfsId
              name
              code
              desc
              lat
              lon
              vehicleMode
            }
          }
        }
      }
    }
  }
`;

type StopQueryResult = {
  stop: {
    gtfsId: string;
    name: string;
    code: string | null;
    desc: string | null;
    lat: number;
    lon: number;
    vehicleMode: string | null;
    stoptimesWithoutPatterns: Array<{
      scheduledArrival: number | null;
      realtimeArrival: number | null;
      scheduledDeparture: number;
      realtimeDeparture: number;
      serviceDay: number;
      realtime: boolean;
      headsign: string | null;
      pickupType: string | null;
      dropoffType: string | null;
      stopPositionInPattern: number | null;
      trip: {
        route: {
          shortName: string | null;
          longName: string | null;
          mode: string;
        };
      } | null;
    }>;
  } | null;
};

type NearbyTramStopsQueryResult = {
  nearest: {
    edges: Array<{
      node: {
        distance: number | null;
        place:
          | {
              __typename: "Stop";
              gtfsId: string;
              name: string;
              code: string | null;
              desc: string | null;
              lat: number;
              lon: number;
              vehicleMode: string | null;
            }
          | {
              __typename: string;
            }
          | null;
      };
    }>;
  } | null;
};

type NearbyPlace = NonNullable<
  NonNullable<NearbyTramStopsQueryResult["nearest"]>["edges"][number]["node"]["place"]
>;
type NearbyStopPlace = Extract<
  NearbyPlace,
  { __typename: "Stop" }
>;

type GeocodingStopSearchResult = {
  features: Array<{
    properties: {
      id?: string;
      addendum?: {
        GTFS?: {
          code?: string;
        };
      };
    };
  }>;
};

export type NearbyStopCandidate = {
  gtfsId: string;
  name: string;
  code: string | null;
  desc: string | null;
  lat: number;
  lon: number;
  distance: number;
};

export type StopWithDepartures = {
  gtfsId: string;
  name: string;
  code: string | null;
  desc: string | null;
  lat: number;
  lon: number;
  vehicleMode: string | null;
  directionHint: string | null;
  departures: Array<{
    scheduledDeparture: number;
    realtimeDeparture: number;
    serviceDay: number;
    realtime: boolean;
    headsign: string;
    routeShortName: string | null;
    routeLongName: string | null;
    routeMode: string;
  }>;
};

export async function fetchNearbyTramStops({
  lat,
  lon,
  maxDistance = 1800,
  maxResults = 16,
  retryWithWiderRadius = true,
}: {
  lat: number;
  lon: number;
  maxDistance?: number;
  maxResults?: number;
  retryWithWiderRadius?: boolean;
}): Promise<NearbyStopCandidate[]> {
  const candidates = await requestNearbyTramStops({ lat, lon, maxDistance, maxResults });
  if (!retryWithWiderRadius || candidates.length >= 4 || maxDistance >= 3500) {
    return candidates.slice(0, 4);
  }

  return requestNearbyTramStops({
    lat,
    lon,
    maxDistance: 3500,
    maxResults: 24,
  }).then((retryCandidates) => retryCandidates.slice(0, 4));
}

export async function fetchStopsWithDepartures(
  stopIds: string[],
  numberOfDepartures = 8,
): Promise<StopWithDepartures[]> {
  const results = await Promise.all(
    stopIds.map(async (stopRef) => {
      const id = await resolveStopId(stopRef);
      const response = await client.request<StopQueryResult>(stopQuery, {
        id,
        numberOfDepartures,
      });

      if (!response.stop) {
        throw new Error(`Stop not found: ${id}`);
      }

      const boardableDepartures = filterBoardableDepartures(response.stop.stoptimesWithoutPatterns);

      return {
        gtfsId: response.stop.gtfsId,
        name: response.stop.name,
        code: response.stop.code,
        desc: response.stop.desc,
        lat: response.stop.lat,
        lon: response.stop.lon,
        vehicleMode: response.stop.vehicleMode,
        directionHint: getDominantHeadsign(boardableDepartures),
        departures: boardableDepartures.map((item) => ({
          scheduledDeparture: item.scheduledDeparture,
          realtimeDeparture: item.realtimeDeparture,
          serviceDay: item.serviceDay,
          realtime: item.realtime,
          headsign: item.headsign ?? item.trip?.route.longName ?? "No destination",
          routeShortName: item.trip?.route.shortName ?? null,
          routeLongName: item.trip?.route.longName ?? null,
          routeMode: item.trip?.route.mode ?? response.stop?.vehicleMode ?? "BUS",
        })),
      };
    }),
  );

  return results;
}

async function requestNearbyTramStops({
  lat,
  lon,
  maxDistance,
  maxResults,
}: {
  lat: number;
  lon: number;
  maxDistance: number;
  maxResults: number;
}) {
  const response = await client.request<NearbyTramStopsQueryResult>(nearbyTramStopsQuery, {
    lat,
    lon,
    maxDistance,
    maxResults,
  });
  const seen = new Set<string>();

  return (response.nearest?.edges ?? [])
    .flatMap((edge): NearbyStopCandidate[] => {
      const place = edge.node.place;
      if (!isNearbyStopPlace(place) || place.vehicleMode !== "TRAM") {
        return [];
      }

      if (seen.has(place.gtfsId)) {
        return [];
      }
      seen.add(place.gtfsId);

      return [
        {
          gtfsId: place.gtfsId,
          name: place.name,
          code: place.code,
          desc: place.desc,
          lat: place.lat,
          lon: place.lon,
          distance: edge.node.distance ?? Number.POSITIVE_INFINITY,
        },
      ];
    })
    .sort((a, b) => a.distance - b.distance);
}

function isNearbyStopPlace(place: NearbyPlace | null): place is NearbyStopPlace {
  return Boolean(place && place.__typename === "Stop");
}

function getDominantHeadsign(
  stoptimes: Array<{
    headsign: string | null;
    trip: {
      route: {
        longName: string | null;
      };
    } | null;
  }>,
) {
  const counts = new Map<string, number>();
  for (const stoptime of stoptimes) {
    const headsign = stoptime.headsign ?? stoptime.trip?.route.longName;
    if (!headsign) {
      continue;
    }

    counts.set(headsign, (counts.get(headsign) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function resolveStopId(stopRef: string): Promise<string> {
  if (isGtfsStopId(stopRef)) {
    return stopRef;
  }

  const url = new URL(GEOCODING_URL);
  url.searchParams.set("text", stopRef);
  url.searchParams.set("layers", "stop");
  url.searchParams.set("size", "10");

  const response = await fetch(url, {
    headers: {
      ...(import.meta.env.VITE_DIGITRANSIT_API_KEY
        ? {
            "digitransit-subscription-key": import.meta.env.VITE_DIGITRANSIT_API_KEY,
          }
        : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Stop lookup failed with ${response.status}.`);
  }

  const result = (await response.json()) as GeocodingStopSearchResult;
  const exactMatch = result.features.find(
    (feature) => feature.properties.addendum?.GTFS?.code === stopRef,
  );

  const geocodingId = exactMatch?.properties.id;
  if (geocodingId) {
    return normalizeGeocodingStopId(geocodingId);
  }

  throw new Error(`Stop not found: ${stopRef}`);
}

function isGtfsStopId(value: string) {
  return value.includes(":");
}

function normalizeGeocodingStopId(value: string) {
  return value.replace(/^GTFS:/, "").replace(/#.*$/, "");
}
