import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import type { StopWithDepartures } from "../api/digitransit";

export const MAP_INITIAL_FIT_DURATION_MS = 900;
export const MAP_IDLE_REFIT_DURATION_MS = 2_800;

export function dispatchMapFitEvent(animated: boolean, duration: number) {
  // Test-only observability for Playwright timing assertions around idle refits.
  window.dispatchEvent(new CustomEvent("pysakki-map-fit", { detail: { animated, duration } }));
}

export function getStopBounds(stops: StopWithDepartures[]) {
  const bounds = new maplibregl.LngLatBounds(
    [stops[0].lon, stops[0].lat],
    [stops[0].lon, stops[0].lat],
  );

  for (const stop of stops.slice(1)) {
    bounds.extend([stop.lon, stop.lat]);
  }

  return bounds;
}

export function getStopFitKey(
  stops: StopWithDepartures[],
  isStackedLayout: boolean,
  splitStackedSchedules: boolean,
) {
  return [
    isStackedLayout ? "stacked" : "desktop",
    splitStackedSchedules ? "split" : "single",
    ...stops.map((stop) => `${stop.gtfsId}:${stop.lat.toFixed(5)}:${stop.lon.toFixed(5)}`),
  ].join("|");
}

export function getMapFitPadding(
  map: MapLibreMap,
  isStackedLayout: boolean,
  splitStackedSchedules: boolean,
): maplibregl.PaddingOptions {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (isStackedLayout) {
    const horizontal = clamp(Math.round(width * 0.06), 18, 42);
    const vertical = clamp(Math.round(height * (splitStackedSchedules ? 0.04 : 0.06)), 14, 38);
    return {
      top: vertical,
      right: horizontal,
      bottom: vertical,
      left: horizontal,
    };
  }

  const horizontal = clamp(Math.round(width * 0.08), 42, 96);
  const vertical = clamp(Math.round(height * 0.09), 36, 84);
  return {
    top: vertical,
    right: horizontal,
    bottom: vertical,
    left: horizontal,
  };
}

export function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - ((-2 * progress + 2) ** 3) / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
