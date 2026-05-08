import { useCallback, useMemo, useRef, useState } from "react";
import type { MapLibreMap } from "maplibre-gl";
import { fetchNearbyStops, type NearbyStopCandidate } from "../api/digitransit";
import {
  MAX_STOP_COUNT,
  serializeUrlState,
  type ViewportState,
} from "../lib/urlState";
import {
  clearUserConfig,
  resolveInitialUserConfig,
  saveUserConfig,
} from "../lib/userConfig";

export type AsyncUiState = "idle" | "loading" | "success" | "error";

interface EditBaseline {
  stopIds: string[];
  viewport: ViewportState;
}

const GEOLOCATION_TIMEOUT_MS = 10_000;
const LOCATION_ZOOM = 15.8;

export function useAppState() {
  const initialUserConfig = useMemo(() => resolveInitialUserConfig(window.location.search), []);
  const initialViewport = initialUserConfig.viewport;
  const initialViewportRef = useRef(initialViewport);

  const [viewport, setViewport] = useState<ViewportState>(initialUserConfig.viewport);
  const [stopIds, setStopIds] = useState<string[]>(initialUserConfig.stopIds);
  const [setupMode, setSetupMode] = useState(initialUserConfig.stopIds.length === 0);
  const [editMode, setEditMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nearbyStops, setNearbyStops] = useState<NearbyStopCandidate[]>([]);
  const [locationStatus, setLocationStatus] = useState<AsyncUiState>("idle");
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "manual">("idle");

  const editBaselineRef = useRef<EditBaseline>({
    stopIds: initialUserConfig.stopIds,
    viewport: initialUserConfig.viewport,
  });

  const stopIdsRef = useRef(initialUserConfig.stopIds);
  useMemo(() => {
    stopIdsRef.current = stopIds;
  }, [stopIds]);

  const beginEditMode = useCallback(() => {
    editBaselineRef.current = { stopIds, viewport };
    setSetupMode(false);
    setEditMode(true);
    setMenuOpen(false);
    setEditStatus("Pan the map, tap a transit stop area, or use nearby suggestions.");
    setShareStatus("idle");
  }, [stopIds, viewport]);

  const beginManualSetup = useCallback(() => {
    editBaselineRef.current = { stopIds: [], viewport };
    setSetupMode(false);
    setEditMode(true);
    setEditStatus("Pan the map and tap near transit stops to add them.");
    setShareStatus("idle");
  }, [viewport]);

  const handleBrowserLocation = useCallback(async (mapRef: React.RefObject<MapLibreMap | null>) => {
    setLocationStatus("loading");
    setEditStatus("Waiting for location permission...");
    setShareStatus("idle");

    try {
      const location = await getBrowserLocation();
      const nextViewport = {
        lat: round(location.lat, 5),
        lon: round(location.lon, 5),
        zoom: LOCATION_ZOOM,
      };
      setViewport(nextViewport);
      mapRef.current?.easeTo({
        center: [nextViewport.lon, nextViewport.lat],
        zoom: nextViewport.zoom,
        duration: 700,
      });

      const candidates = await fetchNearbyStops({
        lat: nextViewport.lat,
        lon: nextViewport.lon,
      });

      setNearbyStops(candidates);
      setStopIds(candidates.map((candidate) => candidate.gtfsId).slice(0, MAX_STOP_COUNT));
      setSetupMode(false);
      setEditMode(true);
      setLocationStatus("success");
      setEditStatus(
        candidates.length > 0
          ? "Nearest departures selected. Review and press Done to save."
          : "No nearby departures found. Pan the map and tap near transit stops to add them.",
      );
    } catch (error) {
      setLocationStatus("error");
      setSetupMode(false);
      setEditMode(true);
      setEditStatus(error instanceof Error ? error.message : "Location unavailable. Choose manually.");
    }
  }, []);

  const refreshNearbyStops = useCallback(async (mapRef: React.RefObject<MapLibreMap | null>) => {
    const center = mapRef.current?.getCenter();
    const nextViewport = center
      ? {
          lat: round(center.lat, 5),
          lon: round(center.lng, 5),
          zoom: round(mapRef.current?.getZoom() ?? viewport.zoom, 2),
        }
      : viewport;

    setEditStatus("Refreshing nearby departures...");
    setShareStatus("idle");

    try {
      const candidates = await fetchNearbyStops({
        lat: nextViewport.lat,
        lon: nextViewport.lon,
      });
      setNearbyStops(candidates);
      setEditStatus(candidates.length > 0 ? "Nearby departures refreshed." : "No nearby departures found.");
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : "Nearby stop lookup failed.");
    }
  }, [viewport]);

  const saveEdits = useCallback(() => {
    saveUserConfig({ stopIds, viewport });
    const nextUrl = serializeUrlState({ viewport, stopIds });
    window.history.replaceState({}, "", nextUrl);
    editBaselineRef.current = { stopIds, viewport };
    setSetupMode(false);
    setEditMode(false);
    setEditStatus(null);
    setShareStatus("idle");
  }, [stopIds, viewport]);

  const cancelEdits = useCallback((mapRef: React.RefObject<MapLibreMap | null>) => {
    const baseline = editBaselineRef.current;
    setStopIds(baseline.stopIds);
    setViewport(baseline.viewport);
    mapRef.current?.easeTo({
      center: [baseline.viewport.lon, baseline.viewport.lat],
      zoom: baseline.viewport.zoom,
      duration: 500,
    });
    setEditMode(false);
    setSetupMode(baseline.stopIds.length === 0);
    setEditStatus(null);
    setShareStatus("idle");
  }, []);

  const resetChoices = useCallback((mapRef: React.RefObject<MapLibreMap | null>) => {
    clearUserConfig();
    setStopIds([]);
    setNearbyStops([]);
    setSetupMode(true);
    setEditMode(false);
    setMenuOpen(false);
    setEditStatus(null);
    setShareStatus("idle");
    setLocationStatus("idle");
    const nextViewport = initialViewportRef.current;
    setViewport(nextViewport);
    window.history.replaceState({}, "", window.location.pathname);
    mapRef.current?.easeTo({
      center: [nextViewport.lon, nextViewport.lat],
      zoom: nextViewport.zoom,
      duration: 500,
    });
  }, []);

  return {
    viewport,
    setViewport,
    stopIds,
    setStopIds,
    stopIdsRef,
    setupMode,
    setSetupMode,
    editMode,
    setEditMode,
    menuOpen,
    setMenuOpen,
    nearbyStops,
    setNearbyStops,
    locationStatus,
    editStatus,
    setEditStatus,
    shareStatus,
    setShareStatus,
    beginEditMode,
    beginManualSetup,
    handleBrowserLocation,
    refreshNearbyStops,
    saveEdits,
    cancelEdits,
    resetChoices,
    initialViewport: initialUserConfig.viewport,
  };
}

function getBrowserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available in this browser. Choose manually."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      () => {
        reject(new Error("Location permission was denied or unavailable. Choose manually."));
      },
      {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: 60_000,
      },
    );
  });
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
