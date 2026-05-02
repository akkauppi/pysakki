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
      await page.waitForSelector("svg g");
      await expect(page.getByTestId("stop-card")).toHaveCount(stopCount);

      await expect(page.locator("svg g")).toHaveCount(stopCount);

      const leaderDots = await page.locator("svg g circle:last-child").evaluateAll((circles) =>
        circles.map((circle) => {
          const element = circle as SVGCircleElement;
          return {
            x: Number(element.getAttribute("cx")),
            y: Number(element.getAttribute("cy")),
          };
        }),
      );

      const uniqueDots = new Set(leaderDots.map((point) => `${Math.round(point.x / 8)}:${Math.round(point.y / 8)}`));
      expect(uniqueDots.size).toBe(stopCount);

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
    });
  }
}
