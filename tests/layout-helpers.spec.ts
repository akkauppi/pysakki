import { expect, test } from "@playwright/test";
import {
  getStackedLayoutMetrics,
} from "../src/lib/scheduleLayout";

test("allocates most of 1-2 stop stacked layouts to the map", () => {
  const metrics = getStackedLayoutMetrics(2, { width: 390, height: 844 }, false);

  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.62);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.66);
  // Accurate calculation: (844 - 16 appPadding - 8 gap) * (1 - 0.65 mapRatio)
  expect(metrics.scheduleBoardHeight).toBeCloseTo(287, 0);
});

test("allocates most of split stacked layouts to the map", () => {
  const metrics = getStackedLayoutMetrics(4, { width: 390, height: 640 }, true);

  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.48);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.55);
  expect(metrics.topBoardRatio).toBeCloseTo(metrics.bottomBoardRatio, 3);
});

