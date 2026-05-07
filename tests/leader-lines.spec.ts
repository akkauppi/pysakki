import { expect, test, type Page } from "@playwright/test";

const stopIds = ["HSL:1001", "HSL:1002", "HSL:1003", "HSL:1004"];
const mapFitSettleMs = 950;

test.beforeEach(async ({ page }) => {
  await mockTransitApi(page);
});

test("gives the map most of a 2-stop stacked phone layout without clipping cards", async ({ page }) => {
  await openStops(page, { width: 390, height: 844 }, 2);

  const metrics = await getLayoutMetrics(page);
  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.6);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.68);
  expect(metrics.mapHeight).toBeGreaterThan(metrics.topPanelHeight * 1.55);

  await expect(page.getByTestId("bottom-stop-panel")).toHaveCount(0);
  await expect(page.getByTestId("leader-3d")).toHaveCount(2);
  await expectNoCardOverflow(page);
});

test("routes 3-stop split stacked leaders between top cards, map, and bottom card", async ({ page }) => {
  await openStops(page, { width: 390, height: 844 }, 3);

  await expect(page.getByTestId("bottom-stop-panel")).toHaveCount(1);
  await expect(page.getByTestId("leader-3d")).toHaveCount(3);

  const metrics = await getLayoutMetrics(page);
  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.56);
  expect(metrics.mapHeight).toBeGreaterThan(metrics.topPanelHeight * 2.2);

  const cardRects = await getCardRects(page);
  expect(cardRects[0].bottom).toBeLessThanOrEqual(metrics.mapTop + 1);
  expect(cardRects[1].bottom).toBeLessThanOrEqual(metrics.mapTop + 1);
  expect(cardRects[2].top).toBeGreaterThanOrEqual(metrics.mapBottom - 1);
  expect(cardRects[2].width).toBeGreaterThan(cardRects[0].width * 1.5);

  await expectNoCardOverflow(page);
});

test("keeps 4-stop split stacked usable on a short phone", async ({ page }) => {
  await openStops(page, { width: 390, height: 640 }, 4);

  const metrics = await getLayoutMetrics(page);
  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.53);
  expect(metrics.mapRatio).toBeLessThanOrEqual(0.6);
  await expect(page.getByTestId("bottom-stop-panel")).toHaveCount(1);
  await expect(page.getByTestId("leader-ribbon")).toHaveCount(4);
  await expectNoCardOverflow(page);
  await expectNoRowOverflow(page);
});

test("keeps 4-stop stacked landscape map dominant while cards stay linked", async ({ page }) => {
  await openStops(page, { width: 640, height: 480 }, 4);

  const metrics = await getLayoutMetrics(page);
  expect(metrics.mapRatio).toBeGreaterThanOrEqual(0.58);
  await expect(page.getByTestId("bottom-stop-panel")).toHaveCount(0);
  await expect(page.getByTestId("leader-ribbon")).toHaveCount(4);
  await expectNoCardOverflow(page);
});

test("keeps desktop leaders attached to the card edge", async ({ page }) => {
  await openStops(page, { width: 1024, height: 600 }, 4);

  const cards = await page.getByTestId("stop-card").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        right: rect.right,
        centerY: rect.top + rect.height / 2,
      };
    }),
  );

  const ribbons = await page.getByTestId("leader-ribbon").evaluateAll((polygons) =>
    polygons.map((polygon) => {
      const points = (polygon.getAttribute("points") ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(",").map(Number));
      const minX = Math.min(...points.map((point) => point[0]));
      return {
        minX,
        maxX: Math.max(...points.map((point) => point[0])),
        leftEdgeCenterY:
          points
            .filter((point) => Math.abs(point[0] - minX) <= 1)
            .reduce((sum, point, _, edgePoints) => sum + point[1] / edgePoints.length, 0),
      };
    }),
  );

  for (let index = 0; index < 4; index += 1) {
    expect(Math.abs(ribbons[index].minX - cards[index].right)).toBeLessThanOrEqual(1);
    expect(ribbons[index].maxX).toBeGreaterThan(cards[index].right + 20);
    expect(Math.abs(ribbons[index].leftEdgeCenterY - cards[index].centerY)).toBeLessThanOrEqual(4);
  }
});

test("waits for map idle before returning a manually moved map to selected stops", async ({ page }) => {
  await page.addInitScript(() => {
    const events: number[] = [];
    window.addEventListener("pysakki-map-fit", (event) => {
      events.push((event as CustomEvent<{ duration: number }>).detail.duration);
    });
    Reflect.set(window, "__pysakkiFitEvents", events);
  });

  await openStops(page, { width: 390, height: 844 }, 2);
  await page.waitForTimeout(mapFitSettleMs);
  await page.evaluate(() => {
    (Reflect.get(window, "__pysakkiFitEvents") as number[]).length = 0;
  });

  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await canvas.dispatchEvent("pointerdown");
  await canvas.dispatchEvent("pointerup");

  await page.waitForTimeout(1_500);
  expect(await getFitEvents(page)).toEqual([]);

  await page.waitForTimeout(4_500);
  expect(await getFitEvents(page)).toContain(2_800);
});

async function openStops(page: Page, viewport: { width: number; height: number }, stopCount: number) {
  await page.setViewportSize(viewport);
  await page.goto(`/?stops=${stopIds.slice(0, stopCount).join(",")}`);
  await page.waitForSelector('[data-testid="leader-3d"]');
  await page.waitForTimeout(mapFitSettleMs);
  await expect(page.getByTestId("stop-card")).toHaveCount(stopCount);
}

async function mockTransitApi(page: Page) {
  await page.route("**/routing/v2/hsl/gtfs/v1", async (route) => {
    const request = route.request().postDataJSON() as { variables?: { id?: string; numberOfDepartures?: number } };
    const stopId = request.variables?.id ?? stopIds[0];
    const index = Math.max(0, stopIds.indexOf(stopId));
    const departureCount = request.variables?.numberOfDepartures ?? 6;

    await route.fulfill({
      json: {
        data: {
          stop: {
            gtfsId: stopId,
            name: `Transit ${index + 1}`,
            code: `H10${index + 1}`,
            desc: null,
            lat: 60.1700 + index * 0.0011,
            lon: 24.9400 + index * 0.0012,
            vehicleMode: index % 2 === 0 ? "TRAM" : "BUS",
            stoptimesWithoutPatterns: Array.from({ length: departureCount }, (_, departureIndex) => ({
              scheduledArrival: 80_000 + departureIndex * 420,
              realtimeArrival: 80_000 + departureIndex * 420,
              scheduledDeparture: 80_030 + departureIndex * 420,
              realtimeDeparture: 80_040 + departureIndex * 420,
              serviceDay: 1_800_000_000,
              realtime: true,
              headsign: index % 2 === 0 ? "Central" : "Harbor",
              pickupType: "SCHEDULED",
              dropoffType: "SCHEDULED",
              stopPositionInPattern: departureIndex + 1,
              trip: {
                route: {
                  shortName: String(4 + index),
                  longName: `Route ${4 + index}`,
                  mode: index % 2 === 0 ? "TRAM" : "BUS",
                },
              },
            })),
          },
        },
      },
    });
  });
}

async function getLayoutMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#root")?.getBoundingClientRect();
    const map = document.querySelector('[data-testid="map-shell"]')?.getBoundingClientRect();
    const topPanel = document.querySelector('[data-testid="stop-board"]')?.getBoundingClientRect();
    const bottomPanel = document.querySelector('[data-testid="bottom-stop-panel"]')?.getBoundingClientRect();
    if (!root || !map || !topPanel) {
      throw new Error("Layout nodes missing.");
    }

    return {
      mapTop: map.top,
      mapBottom: map.bottom,
      mapHeight: map.height,
      mapRatio: map.height / root.height,
      topPanelHeight: topPanel.height,
      bottomPanelHeight: bottomPanel?.height ?? 0,
    };
  });
}

async function getCardRects(page: Page) {
  return page.getByTestId("stop-card").evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
      };
    }),
  );
}

async function expectNoCardOverflow(page: Page) {
  const overflow = await page.getByTestId("stop-card").evaluateAll((cards) =>
    cards.map((card) => ({
      clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight,
      clientWidth: card.clientWidth,
      scrollWidth: card.scrollWidth,
    })),
  );

  for (const card of overflow) {
    expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight + 4);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  }
}

async function expectNoRowOverflow(page: Page) {
  const overflow = await page.getByTestId("departure-row").evaluateAll((rows) =>
    rows.map((row) => ({
      clientHeight: row.clientHeight,
      scrollHeight: row.scrollHeight,
      clientWidth: row.clientWidth,
      scrollWidth: row.scrollWidth,
    })),
  );

  for (const row of overflow) {
    expect(row.scrollHeight).toBeLessThanOrEqual(row.clientHeight + 1);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  }
}

async function getFitEvents(page: Page) {
  return page.evaluate(() => Reflect.get(window, "__pysakkiFitEvents") as number[]);
}
