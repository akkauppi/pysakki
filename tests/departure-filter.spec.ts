import { expect, test } from "@playwright/test";
import { filterBoardableDepartures } from "../src/api/departureFilter";

const baseStoptime = {
  scheduledArrival: 36_000,
  realtimeArrival: 36_000,
  scheduledDeparture: 36_060,
  realtimeDeparture: 36_060,
  dropoffType: "SCHEDULED",
  stopPositionInPattern: 4,
};

test("keeps scheduled pickup departures", () => {
  const departures = filterBoardableDepartures([
    {
      ...baseStoptime,
      pickupType: "SCHEDULED",
    },
  ]);

  expect(departures).toHaveLength(1);
});

test("removes non-boardable pickup rows", () => {
  const departures = filterBoardableDepartures([
    {
      ...baseStoptime,
      pickupType: "NONE",
    },
  ]);

  expect(departures).toHaveLength(0);
});

test("retains unknown pickup rows", () => {
  const departures = filterBoardableDepartures([
    {
      ...baseStoptime,
      pickupType: null,
    },
    {
      ...baseStoptime,
      pickupType: undefined,
    },
    {
      ...baseStoptime,
      pickupType: "CALL_AGENCY",
    },
  ]);

  expect(departures).toHaveLength(3);
});

test("removes an H0446-like final arrival fixture", () => {
  const departures = filterBoardableDepartures([
    {
      ...baseStoptime,
      pickupType: "NONE",
      dropoffType: "SCHEDULED",
      scheduledArrival: 84_120,
      realtimeArrival: 84_135,
      scheduledDeparture: 84_180,
      realtimeDeparture: 84_180,
      stopPositionInPattern: 28,
    },
  ]);

  expect(departures).toHaveLength(0);
});
