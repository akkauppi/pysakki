import {
  DEFAULT_VIEWPORT,
  MAX_STOP_COUNT,
  parseUrlState,
  type ViewportState,
} from "./urlState";

const STORAGE_KEY = "pysakki.config.v1";

export type SavedUserConfigV1 = {
  version: 1;
  stopIds: string[];
  viewport: ViewportState;
  updatedAt: number;
};

export type ResolvedUserConfig = {
  stopIds: string[];
  viewport: ViewportState;
};

export function resolveInitialUserConfig(search: string): ResolvedUserConfig {
  const urlState = parseUrlState(search);
  const savedConfig = readSavedUserConfig();

  return {
    stopIds: urlState.explicit.hasStops
      ? urlState.stopIds
      : savedConfig?.stopIds ?? [],
    viewport: urlState.explicit.hasViewport
      ? urlState.viewport
      : savedConfig?.viewport ?? DEFAULT_VIEWPORT,
  };
}

export function readSavedUserConfig(): SavedUserConfigV1 | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isSavedUserConfig(parsed)) {
      return null;
    }

    return {
      ...parsed,
      stopIds: parsed.stopIds.slice(0, MAX_STOP_COUNT),
    };
  } catch {
    return null;
  }
}

export function saveUserConfig({
  stopIds,
  viewport,
}: {
  stopIds: string[];
  viewport: ViewportState;
}) {
  const config: SavedUserConfigV1 = {
    version: 1,
    stopIds: stopIds.slice(0, MAX_STOP_COUNT),
    viewport,
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

export function clearUserConfig() {
  window.localStorage.removeItem(STORAGE_KEY);
}

function isSavedUserConfig(value: unknown): value is SavedUserConfigV1 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as Partial<SavedUserConfigV1>;
  return (
    config.version === 1 &&
    Array.isArray(config.stopIds) &&
    config.stopIds.every((stopId) => typeof stopId === "string") &&
    isViewport(config.viewport) &&
    typeof config.updatedAt === "number"
  );
}

function isViewport(value: unknown): value is ViewportState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const viewport = value as Partial<ViewportState>;
  return (
    typeof viewport.lat === "number" &&
    Number.isFinite(viewport.lat) &&
    typeof viewport.lon === "number" &&
    Number.isFinite(viewport.lon) &&
    typeof viewport.zoom === "number" &&
    Number.isFinite(viewport.zoom)
  );
}
