import { expect, test } from "@playwright/test";
import {
  getScheduleFit,
  getStackedLayoutMetrics,
} from "../src/lib/scheduleLayout";

test("allocates most of 1-2 stop stacked layouts to the map", () => {
  const metrics = getStackedLayoutMetrics(2, { width: 390, height: 844 }, false);

  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.62);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.66);
  expect(metrics.scheduleBoardHeight).toBeCloseTo(844 * 0.35, 0);
});

test("allocates most of split stacked layouts to the map", () => {
  const metrics = getStackedLayoutMetrics(4, { width: 390, height: 640 }, true);

  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.48);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.55);
  expect(metrics.topBoardRatio).toBeCloseTo(metrics.bottomBoardRatio, 3);
});

test("uses the same stacked board budget when fitting compact schedules", () => {
  const fit = getScheduleFit(
    4,
    6,
    true,
    { width: 390, height: 640 },
    "compact",
    true,
    true,
  );

  expect(fit.visibleCount).toBeGreaterThanOrEqual(0);
  expect(fit.visibleCount).toBeLessThanOrEqual(2);
  expect(fit.rowVariant).toBe("compact");
  expect(fit.rowHeight).toBeGreaterThanOrEqual(32);
});
