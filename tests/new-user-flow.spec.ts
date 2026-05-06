import { expect, test } from "@playwright/test";

test("shows first-run setup when no URL or saved stops exist", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());

  await page.goto("/");

  await expect(page.getByTestId("first-run-panel")).toBeVisible();
  await page.getByTestId("setup-choose-map").click();
  await expect(page.getByTestId("edit-stops-panel")).toBeVisible();
});

test("keeps edit save action reachable on a short phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.addInitScript(() => window.localStorage.clear());

  await page.goto("/");
  await page.getByTestId("setup-choose-map").click();

  const saveButton = page.getByTestId("edit-save");
  await expect(saveButton).toBeVisible();
  const box = await saveButton.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
});

test("uses saved browser config when URL stops are absent", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "pysakki.config.v1",
      JSON.stringify({
        version: 1,
        stopIds: ["H0831", "H0446"],
        viewport: { lat: 60.16, lon: 24.94, zoom: 15.2 },
        updatedAt: Date.now(),
      }),
    );
  });

  await page.goto("/");

  await expect(page.getByTestId("first-run-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByText("H0831, H0446")).toBeVisible();
});

test("reset choices clears saved config and returns to first-run setup", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "pysakki.config.v1",
      JSON.stringify({
        version: 1,
        stopIds: ["H0831", "H0446"],
        viewport: { lat: 60.16, lon: 24.94, zoom: 15.2 },
        updatedAt: Date.now(),
      }),
    );
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByTestId("reset-choices").click();

  await expect(page.getByTestId("first-run-panel")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const savedConfig = await page.evaluate(() => window.localStorage.getItem("pysakki.config.v1"));
  expect(savedConfig).toBeNull();
});

test("location setup selects nearby mixed transit and saves a shareable URL", async ({ browser }) => {
  const context = await browser.newContext({
    geolocation: { latitude: 60.1701, longitude: 24.9412 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();

  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/routing/v2/hsl/gtfs/v1", async (route) => {
    const request = route.request().postDataJSON() as { query?: string; variables?: { id?: string } };
    if (request.query?.includes("NearbyTransitStops")) {
      const modes = ["BUS", "TRAM", "RAIL", "SUBWAY"] as const;
      await route.fulfill({
        json: {
          data: {
            nearest: {
              edges: ["HSL:1001", "HSL:1002", "HSL:1003", "HSL:1004"].map((gtfsId, index) => ({
                node: {
                  distance: 80 + index * 40,
                  place: {
                    __typename: "Stop",
                    gtfsId,
                    name: `Transit ${index + 1}`,
                    code: `T${index + 1}`,
                    desc: null,
                    lat: 60.1701 + index * 0.0001,
                    lon: 24.9412 + index * 0.0001,
                    vehicleMode: modes[index],
                  },
                },
              })),
            },
          },
        },
      });
      return;
    }

    const stopId = request.variables?.id ?? "HSL:1001";
    await route.fulfill({
      json: {
        data: {
          stop: {
            gtfsId: stopId,
            name: `Selected ${stopId}`,
            code: stopId.replace("HSL:", "T"),
            desc: null,
            lat: 60.17,
            lon: 24.94,
            vehicleMode: "TRAM",
            stoptimesWithoutPatterns: [],
          },
        },
      },
    });
  });

  await page.goto("/");
  await page.getByTestId("setup-use-location").click();

  await expect(page.getByTestId("edit-stops-panel")).toBeVisible();
  await expect(page.getByTestId("edit-selected-stops").getByRole("button")).toHaveCount(4);

  await page.getByTestId("edit-save").click();

  await expect(page).toHaveURL(/stops=HSL%3A1001%2CHSL%3A1002%2CHSL%3A1003%2CHSL%3A1004/);
  const savedStops = await page.evaluate(() => JSON.parse(window.localStorage.getItem("pysakki.config.v1") ?? "{}").stopIds);
  expect(savedStops).toEqual(["HSL:1001", "HSL:1002", "HSL:1003", "HSL:1004"]);

  await context.close();
});

test("shows direction hints for duplicate stop names", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.route("**/routing/v2/hsl/gtfs/v1", async (route) => {
    const request = route.request().postDataJSON() as { variables?: { id?: string } };
    const stopId = request.variables?.id ?? "HSL:1001";
    await route.fulfill({
      json: {
        data: {
          stop: {
            gtfsId: stopId,
            name: "Shared stop",
            code: stopId.endsWith("1") ? "A1" : "B2",
            desc: null,
            lat: stopId.endsWith("1") ? 60.17 : 60.171,
            lon: stopId.endsWith("1") ? 24.94 : 24.941,
            vehicleMode: "TRAM",
            stoptimesWithoutPatterns: [
              {
                scheduledArrival: 40_000,
                realtimeArrival: 40_000,
                scheduledDeparture: 40_020,
                realtimeDeparture: 40_020,
                serviceDay: 1_800_000_000,
                realtime: false,
                headsign: stopId.endsWith("1") ? "North" : "South",
                pickupType: "SCHEDULED",
                dropoffType: "SCHEDULED",
                stopPositionInPattern: 2,
                trip: {
                  route: {
                    shortName: "9",
                    longName: "Route 9",
                    mode: "TRAM",
                  },
                },
              },
            ],
          },
        },
      },
    });
  });

  await page.goto("/?stops=HSL:1001,HSL:1002");

  await expect(page.getByTestId("stop-direction-hint")).toHaveCount(2);
  await expect(page.getByText("A1 · toward North")).toBeVisible();
  await expect(page.getByText("B2 · toward South")).toBeVisible();
});
