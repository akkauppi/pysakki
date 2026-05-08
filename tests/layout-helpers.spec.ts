import { expect, test } from "@playwright/test";
import {
  getStackedPhoneDepartureRows,
  getStackedLayoutMetrics,
} from "../src/lib/scheduleLayout";

test("allocates most of 1-2 stop stacked layouts to the map", () => {
  const metrics = getStackedLayoutMetrics(2, { width: 390, height: 844 }, false);

  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.62);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.66);
  // Accurate calculation: (844 - 16 appPadding - 8 gap) * (1 - 0.65 mapRatio)
  expect(metrics.scheduleBoardHeight).toBeCloseTo(287, 0);
});

test("reserves enough split stacked schedule space for two full rows", () => {
  const metrics = getStackedLayoutMetrics(4, { width: 390, height: 640 }, true);

  expect(metrics.departureRows).toBe(2);
  expect(metrics.scheduleBoardHeight).toBeCloseTo(170, 0);
  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.3);
  expect(metrics.topBoardRatio).toBeGreaterThan(metrics.bottomBoardRatio);
});

test("caps phone portrait departure rows deterministically by height", () => {
  expect(getStackedPhoneDepartureRows({ width: 390, height: 640 })).toBe(2);
  expect(getStackedPhoneDepartureRows({ width: 390, height: 844 })).toBe(3);
  expect(getStackedPhoneDepartureRows({ width: 720, height: 1600 })).toBe(4);
});
