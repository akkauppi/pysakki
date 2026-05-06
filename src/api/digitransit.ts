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

export type StopWithDepartures = {
  gtfsId: string;
  name: string;
  code: string | null;
  desc: string | null;
  lat: number;
  lon: number;
  vehicleMode: string | null;
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

      return {
        gtfsId: response.stop.gtfsId,
        name: response.stop.name,
        code: response.stop.code,
        desc: response.stop.desc,
        lat: response.stop.lat,
        lon: response.stop.lon,
        vehicleMode: response.stop.vehicleMode,
        departures: filterBoardableDepartures(response.stop.stoptimesWithoutPatterns).map((item) => ({
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
