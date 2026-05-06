import { expect, test } from "@playwright/test";

const stopIds = ["H0831", "H0446", "H0405", "H0430"];
const mapFitSettleMs = 950;

const viewports = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 390, height: 640 },
  { width: 480, height: 800 },
  { width: 640, height: 480 },
  { width: 768, height: 600 },
  { width: 900, height: 600 },
  { width: 1024, height: 600 },
] as const;

for (const viewport of viewports) {
  for (const stopCount of [3, 4] as const) {
    test(`keeps ${stopCount} stops stable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/?stops=${stopIds.slice(0, stopCount).join(",")}`);
      await page.waitForSelector('[data-testid="leader-3d"]');
      await page.waitForTimeout(mapFitSettleMs);
      await expect(page.getByTestId("stop-card")).toHaveCount(stopCount);

      await expect(page.getByTestId("leader-3d")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-shadow")).toHaveCount(0);
      await expect(page.getByTestId("leader-underside")).toHaveCount(0);
      await expect(page.getByTestId("leader-frost")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-ribbon")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-glow")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-soft-shadow")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-inner-shadow")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-drop")).toHaveCount(0);
      await expect(page.getByTestId("leader-deck")).toHaveCount(0);
      await expect(page.getByTestId("leader-highlight")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-stop-cap")).toHaveCount(stopCount);
      await expect(page.getByTestId("leader-card-join")).toHaveCount(0);
      await expect(page.getByTestId("leader-card-cap")).toHaveCount(0);

      const frostedLayers = await page.getByTestId("leader-frost").evaluateAll((layers) =>
        layers.map((layer) => {
          const style = getComputedStyle(layer);
          return {
            clipPath: style.clipPath,
            backdropFilter: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"),
          };
        }),
      );

      for (const layer of frostedLayers) {
        expect(layer.clipPath).toContain("polygon");
        expect(layer.backdropFilter).toContain("blur");
      }

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

      const scheduleVariants = await page.getByTestId("departure-list").evaluateAll((lists) =>
        lists.map((list) => list.getAttribute("data-schedule-variant")),
      );
      expect(new Set(scheduleVariants).size).toBe(1);

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
        expect(inset.topInset).toBeGreaterThanOrEqual(8);
        expect(inset.bottomInset).toBeGreaterThanOrEqual(8);
      }

      const scheduledTimeInsets = await page.getByTestId("departure-scheduled-time").evaluateAll((times) =>
        times.map((time) => {
          const row = time.closest('[data-testid="departure-row"]');
          if (!row) {
            throw new Error("Scheduled time is missing its departure row.");
          }

          const rowRect = row.getBoundingClientRect();
          const timeRect = time.getBoundingClientRect();
          return {
            bottomInset: rowRect.bottom - timeRect.bottom,
          };
        }),
      );

      for (const inset of scheduledTimeInsets) {
        expect(inset.bottomInset).toBeGreaterThanOrEqual(8);
      }

      const modeIconInsets = await page.getByTestId("departure-mode-icon").evaluateAll((icons) =>
        icons.map((icon) => {
          const row = icon.closest('[data-testid="departure-row"]');
          if (!row) {
            throw new Error("Mode icon is missing its departure row.");
          }

          const rowRect = row.getBoundingClientRect();
          const iconRect = icon.getBoundingClientRect();
          return {
            topInset: iconRect.top - rowRect.top,
            bottomInset: rowRect.bottom - iconRect.bottom,
          };
        }),
      );

      for (const inset of modeIconInsets) {
        expect(inset.topInset).toBeGreaterThanOrEqual(8);
        expect(inset.bottomInset).toBeGreaterThanOrEqual(8);
      }

      const rowRadii = await page.getByTestId("departure-row").evaluateAll((rows) =>
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return {
            height: rect.height,
            radius: Number.parseFloat(getComputedStyle(row).borderTopLeftRadius),
          };
        }),
      );

      for (const row of rowRadii) {
        expect(row.radius).toBeLessThanOrEqual(Math.min(18, row.height * 0.33) + 0.5);
      }
    });
  }
}

test("keeps phone DPR schedule rows and attribution comfortable", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
  });
  const page = await context.newPage();

  await page.goto(`/?stops=${stopIds.join(",")}`);
  await page.waitForSelector('[data-testid="departure-list"]');

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
    expect(inset.topInset).toBeGreaterThanOrEqual(8);
    expect(inset.bottomInset).toBeGreaterThanOrEqual(8);
  }

  const attribution = await page.getByTestId("map-attribution").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      text: element.textContent ?? "",
    };
  });
  expect(attribution.height).toBeLessThanOrEqual(22);
  expect(attribution.scrollWidth).toBeLessThanOrEqual(attribution.clientWidth + 1);
  expect(attribution.text).toContain("HSL Digitransit");

  await context.close();
});

test("does not flicker row icon mode while resizing stacked layout vertically", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
  });
  const page = await context.newPage();

  await page.goto(`/?stops=${stopIds.slice(0, 3).join(",")}`);
  await page.waitForSelector('[data-testid="departure-list"]');

  const heightsDown = [844, 800, 760, 740, 720, 700, 680, 640];
  const variantsDown: Array<string | null> = [];
  for (const height of heightsDown) {
    await page.setViewportSize({ width: 390, height });
    await page.waitForTimeout(60);
    variantsDown.push(await page.getByTestId("departure-list").first().getAttribute("data-schedule-variant"));
  }

  expect(countVariantTransitions(variantsDown, "compactIcon", "compact")).toBeLessThanOrEqual(1);
  expect(variantsDown.includes("compactIcon") && variantsDown.at(-1) === "compactIcon").toBe(false);

  const heightsUp = [640, 680, 700, 720, 740, 760, 800, 844];
  const variantsUp: Array<string | null> = [];
  for (const height of heightsUp) {
    await page.setViewportSize({ width: 390, height });
    await page.waitForTimeout(60);
    variantsUp.push(await page.getByTestId("departure-list").first().getAttribute("data-schedule-variant"));
  }

  expect(countVariantTransitions(variantsUp, "compact", "compactIcon")).toBeLessThanOrEqual(1);
  const firstIconIndex = variantsUp.indexOf("compactIcon");
  if (firstIconIndex >= 0) {
    expect(heightsUp[firstIconIndex]).toBeGreaterThanOrEqual(760);
  }

  await context.close();
});

function countVariantTransitions(values: Array<string | null>, from: string, to: string) {
  let transitions = 0;

  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === from && values[index] === to) {
      transitions += 1;
    }
  }

  return transitions;
}
