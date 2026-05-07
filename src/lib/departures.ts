import type { StopWithDepartures } from "../api/digitransit";

const DEPARTURE_EXPIRY_GRACE_MS = 45_000;

export type Departure = StopWithDepartures["departures"][number];

export function getDepartureLimit(stopCount: number) {
  if (stopCount >= 4) {
    return 6;
  }

  if (stopCount === 3) {
    return 7;
  }

  if (stopCount === 2) {
    return 8;
  }

  return 9;
}

export function filterStopsWithActiveDepartures(stops: StopWithDepartures[], now: Date): StopWithDepartures[] {
  return stops.map((stop) => ({
    ...stop,
    departures: stop.departures.filter((departure) => !isDepartureExpired(departure, now)),
  }));
}

export function orderStopsByIds(stops: StopWithDepartures[], orderedIds: string[]) {
  if (orderedIds.length === 0) {
    return stops;
  }

  const order = new Map(orderedIds.map((stopId, index) => [stopId, index]));
  return [...stops].sort(
    (a, b) => (order.get(a.gtfsId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.gtfsId) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function mergeArrangedStopIds(current: string[], stops: StopWithDepartures[]) {
  const stopIds = stops.map((stop) => stop.gtfsId);
  const next = [
    ...current.filter((stopId) => stopIds.includes(stopId)),
    ...stopIds.filter((stopId) => !current.includes(stopId)),
  ];

  return sameStringList(current, next) ? current : next;
}

export function sameStringList(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function getMaxDepartureCount(stops: StopWithDepartures[]) {
  return stops.reduce((max, stop) => Math.max(max, stop.departures.length), 0);
}

export function getDepartureKey(stopId: string, departure: Departure) {
  return [
    stopId,
    departure.serviceDay,
    departure.scheduledDeparture,
    departure.realtimeDeparture,
    departure.routeShortName ?? departure.routeMode,
    departure.headsign,
  ].join("-");
}

function isDepartureExpired(departure: Departure, now: Date) {
  return getDepartureTimestamp(departure) + DEPARTURE_EXPIRY_GRACE_MS < now.getTime();
}

function getDepartureTimestamp(departure: Departure) {
  return (departure.serviceDay + departure.realtimeDeparture) * 1000;
}
