export type ViewportState = {
  lat: number;
  lon: number;
  zoom: number;
};

export const DEFAULT_VIEWPORT: ViewportState = {
  lat: 60.15888,
  lon: 24.93503,
  zoom: 16.6,
};

export const MAX_STOP_COUNT = 4;
export const DEFAULT_STOP_IDS = ["H0831", "H0446"];

export function parseUrlState(search: string) {
  const params = new URLSearchParams(search);

  const lat = parseNumber(params.get("lat"), DEFAULT_VIEWPORT.lat);
  const lon = parseNumber(params.get("lon"), DEFAULT_VIEWPORT.lon);
  const zoom = parseNumber(params.get("zoom"), DEFAULT_VIEWPORT.zoom);

  const stopIds = (params.get("stops") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, MAX_STOP_COUNT);

  return {
    viewport: {
      lat,
      lon,
      zoom,
    },
    stopIds: stopIds.length > 0 ? stopIds : DEFAULT_STOP_IDS.slice(0, MAX_STOP_COUNT),
  };
}

export function serializeUrlState({
  viewport,
  stopIds,
}: {
  viewport: ViewportState;
  stopIds: string[];
}) {
  const params = new URLSearchParams();
  params.set("lat", viewport.lat.toFixed(5));
  params.set("lon", viewport.lon.toFixed(5));
  params.set("zoom", viewport.zoom.toFixed(2));

  if (stopIds.length > 0) {
    params.set("stops", stopIds.join(","));
  }

  return `?${params.toString()}`;
}

function parseNumber(value: string | null, fallback: number) {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
