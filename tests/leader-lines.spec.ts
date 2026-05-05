import { expect, test } from "@playwright/test";

const stopIds = ["H0831", "H0446", "H0405", "H0430"];

const viewports = [
  { width: 390, height: 640 },
  { width: 480, height: 800 },
  { width: 640, height: 480 },
  { width: 1024, height: 600 },
] as const;

for (const viewport of viewports) {
  for (const stopCount of [3, 4] as const) {
    test(`keeps ${stopCount} stops stable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/?stops=${stopIds.slice(0, stopCount).join(",")}`);
      await page.waitForSelector('[data-testid="leader-3d"]');
      await expect(page.getByTestId("stop-card")).toHaveCount(stopCount);

      await expect(page.getByTestId("leader-3d")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-shadow")).toHaveCount(0);
      await expect(page.getByTestId("leader-underside")).toHaveCount(0);
      await expect(page.getByTestId("leader-ribbon")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-drop")).toHaveCount(0);
      await expect(page.getByTestId("leader-deck")).toHaveCount(0);
      await expect(page.getByTestId("leader-highlight")).toHaveCount(0);
      await expect(page.getByTestId("leader-stop-cap")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-card-join")).toHaveCount(0);
      await expect(page.getByTestId("leader-card-cap")).toHaveCount(0);

      const stopCaps = await page.getByTestId("leader-stop-cap").evaluateAll((circles) =>
        circles.map((circle) => {
          const element = circle as SVGCircleElement;
          return {
            x: Number(element.getAttribute("cx")),
            y: Number(element.getAttribute("cy")),
          };
        }),
      );

      const leaderRibbons = await page.getByTestId("leader-ribbon").evaluateAll((polygons) =>
        polygons.map((polygon) => {
          const points = (polygon.getAttribute("points") ?? "")
            .trim()
            .split(/\s+/)
            .map((pair) => pair.split(",").map(Number));
          return {
            minX: Math.min(...points.map((point) => point[0])),
            maxX: Math.max(...points.map((point) => point[0])),
            minY: Math.min(...points.map((point) => point[1])),
            maxY: Math.max(...points.map((point) => point[1])),
            leftEdgeCenterY:
              points
                .filter((point) => Math.abs(point[0] - Math.min(...points.map((innerPoint) => innerPoint[0]))) <= 1)
                .reduce((sum, point, _, edgePoints) => sum + point[1] / edgePoints.length, 0),
          };
        }),
      );

      const uniqueStopCaps = new Set(stopCaps.map((point) => `${Math.round(point.x / 8)}:${Math.round(point.y / 8)}`));
      expect(uniqueStopCaps.size).toBe(stopCount);

      if (viewport.width >= 768) {
        const cards = await page.getByTestId("stop-card").evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              right: rect.right,
              centerY: rect.top + rect.height / 2,
            };
          }),
        );

        for (let index = 0; index < stopCount; index += 1) {
          expect(Math.abs(leaderRibbons[index].minX - cards[index].right)).toBeLessThanOrEqual(1);
          expect(leaderRibbons[index].maxX).toBeGreaterThan(cards[index].right + 20);
          expect(Math.abs(leaderRibbons[index].leftEdgeCenterY - cards[index].centerY)).toBeLessThanOrEqual(4);
        }
      }

      const scheduleScales = await page.getByTestId("departure-list").evaluateAll((lists) =>
        lists.map((list) => list.getAttribute("data-schedule-scale")),
      );
      expect(new Set(scheduleScales).size).toBe(1);

      const departureListCounts = await page.getByTestId("departure-list").evaluateAll((lists) =>
        lists.map((list) => ({
          visible: Number(list.getAttribute("data-visible-departures")),
          rows: list.querySelectorAll('[data-testid="departure-row"]').length,
        })),
      );

      for (const list of departureListCounts) {
        expect(list.rows).toBeLessThanOrEqual(list.visible);
      }

      const cardOverflow = await page.getByTestId("stop-card").evaluateAll((cards) =>
        cards.map((card) => ({
          clientHeight: card.clientHeight,
          scrollHeight: card.scrollHeight,
          clientWidth: card.clientWidth,
          scrollWidth: card.scrollWidth,
        })),
      );

      for (const card of cardOverflow) {
        expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight + 1);
        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
      }

      const rowOverflow = await page.getByTestId("departure-row").evaluateAll((rows) =>
        rows.map((row) => ({
          clientHeight: row.clientHeight,
          scrollHeight: row.scrollHeight,
          clientWidth: row.clientWidth,
          scrollWidth: row.scrollWidth,
        })),
      );

      for (const row of rowOverflow) {
        expect(row.scrollHeight).toBeLessThanOrEqual(row.clientHeight + 1);
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
      }

      const rowContentInsets = await page.getByTestId("departure-row").evaluateAll((rows) =>
        rows.map((row) => {
          const rowRect = row.getBoundingClientRect();
          const contentRects = Array.from(row.children)
            .map((child) => child.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0);
          return {
            topInset: Math.min(...contentRects.map((rect) => rect.top - rowRect.top)),
            bottomInset: Math.min(...contentRects.map((rect) => rowRect.bottom - rect.bottom)),
          };
        }),
      );

      for (const inset of rowContentInsets) {
        expect(inset.topInset).toBeGreaterThanOrEqual(2);
        expect(inset.bottomInset).toBeGreaterThanOrEqual(2);
      }
    });
  }
}
