import { expect, test } from "@playwright/test";
import { DEFAULT_VIEWPORT, parseUrlState, serializeUrlState } from "../src/lib/urlState";

test("does not inject default stops when stops are omitted", () => {
  const state = parseUrlState("");

  expect(state.stopIds).toEqual([]);
  expect(state.explicit.hasStops).toBe(false);
  expect(state.explicit.hasViewport).toBe(false);
  expect(state.viewport).toEqual(DEFAULT_VIEWPORT);
});

test("tracks explicit stop and viewport URL fields", () => {
  const state = parseUrlState("?lat=60.17&lon=24.94&zoom=14.5&stops=H0831,H0446");

  expect(state.stopIds).toEqual(["H0831", "H0446"]);
  expect(state.explicit.hasStops).toBe(true);
  expect(state.explicit.hasViewport).toBe(true);
  expect(state.viewport).toEqual({
    lat: 60.17,
    lon: 24.94,
    zoom: 14.5,
  });
});

test("serializes share URLs with stops and viewport", () => {
  expect(
    serializeUrlState({
      viewport: {
        lat: 60.171234,
        lon: 24.941234,
        zoom: 13.456,
      },
      stopIds: ["HSL:1040129", "HSL:1040130"],
    }),
  ).toBe("?lat=60.17123&lon=24.94123&zoom=13.46&stops=HSL%3A1040129%2CHSL%3A1040130");
});
