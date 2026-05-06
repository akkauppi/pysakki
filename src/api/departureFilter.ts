export type StoptimeBoardingFields = {
  pickupType?: string | null;
  dropoffType?: string | null;
  scheduledArrival?: number | null;
  realtimeArrival?: number | null;
  scheduledDeparture: number;
  realtimeDeparture: number;
  stopPositionInPattern?: number | null;
};

export function isBoardableDeparture(stoptime: StoptimeBoardingFields) {
  return stoptime.pickupType !== "NONE";
}

export function filterBoardableDepartures<T extends StoptimeBoardingFields>(stoptimes: T[]) {
  return stoptimes.filter(isBoardableDeparture);
}
