import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { FeatureCollection, Point } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { StopWithDepartures } from "../api/digitransit";
import { loadHslStyle } from "../lib/hslStyle";
import {
  dispatchMapFitEvent,
  easeInOutCubic,
  getMapFitPadding,
  getStopBounds,
  getStopFitKey,
  MAP_IDLE_REFIT_DURATION_MS,
  MAP_INITIAL_FIT_DURATION_MS,
} from "../lib/mapFit";
import { serializeUrlState, type ViewportState } from "../lib/urlState";
import { toVehicleCollection } from "../lib/vehicleGeoJson";
import type { VehicleBounds, VehicleSnapshot } from "../lib/useVehicleStream";

const stopSourceId = "selected-stops";
const vehicleSourceId = "vehicles";
const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;
const HSL_LABEL_FONT = ["Gotham Rounded Medium"];
const MAP_USER_IDLE_REFIT_MS = 5_000;

export function useTransitMap({
  initialViewport,
  stopIds,
  stops,
  displayStops,
  setupMode,
  editMode,
  isStackedLayout,
  splitStackedSchedules,
  vehicles,
  setViewport,
  setVehicleBounds,
}: {
  initialViewport: ViewportState;
  stopIds: string[];
  stops: StopWithDepartures[];
  displayStops: StopWithDepartures[];
  setupMode: boolean;
  editMode: boolean;
  isStackedLayout: boolean;
  splitStackedSchedules: boolean;
  vehicles: Map<string, VehicleSnapshot>;
  setViewport: Dispatch<SetStateAction<ViewportState>>;
  setVehicleBounds: Dispatch<SetStateAction<VehicleBounds>>;
}) {
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleLoading, setStyleLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleSourceRef = useRef<GeoJSONSource | null>(null);
  const stopSourceRef = useRef<GeoJSONSource | null>(null);
  const vehicleFrameRef = useRef<number | null>(null);
  const mapProgrammaticMoveRef = useRef(false);
  const userMapInteractionRef = useRef(false);
  const mapIdleRefitTimerRef = useRef<number | null>(null);
  const latestStopBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const lastAutoFitKeyRef = useRef<string | null>(null);
  const vehiclesRef = useRef<Map<string, VehicleSnapshot>>(new Map());
  const stopIdsRef = useRef(stopIds);
  const setupModeRef = useRef(setupMode);
  const editModeRef = useRef(editMode);
  const mapFitLayoutRef = useRef({
    isStackedLayout,
    splitStackedSchedules,
  });

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    stopIdsRef.current = stopIds;
  }, [stopIds]);

  useEffect(() => {
    setupModeRef.current = setupMode;
  }, [setupMode]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  mapFitLayoutRef.current = {
    isStackedLayout,
    splitStackedSchedules,
  };

  const clearPendingMapRefit = useCallback(() => {
    if (mapIdleRefitTimerRef.current !== null) {
      window.clearTimeout(mapIdleRefitTimerRef.current);
      mapIdleRefitTimerRef.current = null;
    }
  }, []);

  const fitLatestStopBounds = useCallback((duration: number, animated = false) => {
    const map = mapRef.current;
    const bounds = latestStopBoundsRef.current;
    if (!map || !bounds || setupModeRef.current || editModeRef.current) {
      return;
    }

    const padding = getMapFitPadding(
      map,
      mapFitLayoutRef.current.isStackedLayout,
      mapFitLayoutRef.current.splitStackedSchedules,
    );
    mapProgrammaticMoveRef.current = true;
    dispatchMapFitEvent(animated, duration);

    if (animated) {
      const camera = map.cameraForBounds(bounds, {
        padding,
        maxZoom: 17.6,
      });

      if (camera) {
        // The idle return is intentionally an easeTo camera move: fitBounds can snap after
        // manual gestures, while easeTo makes the kiosk visibly recover without feeling broken.
        map.easeTo({
          ...camera,
          duration,
          essential: true,
          easing: easeInOutCubic,
        });
        return;
      }
    }

    map.fitBounds(bounds, {
      padding,
      maxZoom: 17.6,
      duration,
      essential: true,
    });
  }, []);

  const scheduleIdleMapRefit = useCallback(() => {
    clearPendingMapRefit();
    mapIdleRefitTimerRef.current = window.setTimeout(() => {
      mapIdleRefitTimerRef.current = null;
      userMapInteractionRef.current = false;
      fitLatestStopBounds(MAP_IDLE_REFIT_DURATION_MS, true);
    }, MAP_USER_IDLE_REFIT_MS);
  }, [clearPendingMapRefit, fitLatestStopBounds]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapMap() {
      if (!mapContainerRef.current || mapRef.current) {
        return;
      }

      setStyleLoading(true);
      setStyleError(null);

      try {
        const style = await loadHslStyle();
        if (cancelled || !mapContainerRef.current) {
          return;
        }

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style,
          center: [initialViewport.lon, initialViewport.lat],
          zoom: initialViewport.zoom,
          attributionControl: false,
        });

        let mapSetupComplete = false;

        const installMapOverlays = () => {
          if (mapSetupComplete || cancelled) {
            return;
          }

          mapSetupComplete = true;

          const emptyPoints: FeatureCollection<Point> = {
            type: "FeatureCollection",
            features: [],
          };

          map.addSource(stopSourceId, {
            type: "geojson",
            data: emptyPoints,
          });

          map.addSource(vehicleSourceId, {
            type: "geojson",
            data: emptyPoints,
          });

          map.addLayer({
            id: "stop-circles",
            type: "circle",
            source: stopSourceId,
            paint: {
              "circle-radius": 13,
              "circle-color": [
                "match",
                ["get", "order"],
                1,
                STOP_MARKER_COLORS[0],
                2,
                STOP_MARKER_COLORS[1],
                3,
                STOP_MARKER_COLORS[2],
                4,
                STOP_MARKER_COLORS[3],
                "#ffffff",
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#f8fafc",
            },
          });

          map.addLayer({
            id: "stop-labels",
            type: "symbol",
            source: stopSourceId,
            layout: {
              "text-field": ["coalesce", ["get", "code"], ["get", "name"]],
              "text-font": HSL_LABEL_FONT,
              "text-offset": [0, 1.25],
              "text-size": 12,
              "text-anchor": "top",
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#f8fafc",
              "text-halo-width": 1.5,
            },
          });

          map.addLayer({
            id: "vehicle-dots",
            type: "circle",
            source: vehicleSourceId,
            paint: {
              "circle-radius": [
                "match",
                ["get", "mode"],
                "TRAM",
                7,
                "RAIL",
                7,
                "SUBWAY",
                7,
                5.5,
              ],
              "circle-color": [
                "match",
                ["get", "mode"],
                "TRAM",
                "#1d4ed8",
                "RAIL",
                "#7c3aed",
                "SUBWAY",
                "#ea580c",
                "#059669",
              ],
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#ffffff",
            },
          });

          map.addLayer({
            id: "vehicle-labels",
            type: "symbol",
            source: vehicleSourceId,
            minzoom: 11,
            layout: {
              "text-field": ["coalesce", ["get", "label"], ""],
              "text-font": HSL_LABEL_FONT,
              "text-size": 11,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
            },
            paint: {
              "text-color": "#0f172a",
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.25,
            },
          });

          vehicleSourceRef.current = map.getSource(vehicleSourceId) as GeoJSONSource;
          stopSourceRef.current = map.getSource(stopSourceId) as GeoJSONSource;
          setMapReady(true);
        };

        map.once("style.load", installMapOverlays);
        map.once("load", installMapOverlays);

        const updateMapViewport = () => {
          const center = map.getCenter();
          const bounds = map.getBounds();
          const nextViewport = {
            lat: round(center.lat, 5),
            lon: round(center.lng, 5),
            zoom: round(map.getZoom(), 2),
          };

          setViewport((current) =>
            current.lat === nextViewport.lat &&
            current.lon === nextViewport.lon &&
            current.zoom === nextViewport.zoom
              ? current
              : nextViewport,
          );
          setVehicleBounds({
            north: round(bounds.getNorth(), 5),
            south: round(bounds.getSouth(), 5),
            east: round(bounds.getEast(), 5),
            west: round(bounds.getWest(), 5),
          });

          const nextUrl = serializeUrlState({
            viewport: nextViewport,
            stopIds: stopIdsRef.current,
          });

          if (!setupModeRef.current && !editModeRef.current && stopIdsRef.current.length > 0) {
            window.history.replaceState({}, "", nextUrl);
          }
        };

        updateMapViewport();

        const markUserMapInteraction = (event: { originalEvent?: Event }) => {
          // Programmatic moves also emit MapLibre movement events, so keep them out of
          // the "user touched the map" path that schedules idle recovery.
          if (!event.originalEvent || mapProgrammaticMoveRef.current) {
            return;
          }

          userMapInteractionRef.current = true;
          clearPendingMapRefit();
        };
        const markDomUserMapInteraction = () => {
          if (mapProgrammaticMoveRef.current) {
            return;
          }

          userMapInteractionRef.current = true;
          clearPendingMapRefit();
        };
        const handleDomUserInteractionEnd = () => {
          if (!userMapInteractionRef.current || mapProgrammaticMoveRef.current) {
            return;
          }

          scheduleIdleMapRefit();
        };

        const handleMapMoveEnd = (event: { originalEvent?: Event }) => {
          updateMapViewport();

          if (mapProgrammaticMoveRef.current) {
            mapProgrammaticMoveRef.current = false;
            return;
          }

          if (event.originalEvent || userMapInteractionRef.current) {
            userMapInteractionRef.current = false;
            scheduleIdleMapRefit();
          }
        };

        map.on("movestart", markUserMapInteraction);
        map.on("dragstart", markUserMapInteraction);
        map.on("zoomstart", markUserMapInteraction);
        map.on("moveend", handleMapMoveEnd);
        map.getCanvas().addEventListener("pointerdown", markDomUserMapInteraction);
        map.getCanvas().addEventListener("pointerup", handleDomUserInteractionEnd);
        map.getCanvas().addEventListener("wheel", markDomUserMapInteraction);
        map.getCanvas().addEventListener("wheel", handleDomUserInteractionEnd);

        mapRef.current = map;
      } catch (error) {
        setStyleError(error instanceof Error ? error.message : "Map style could not be loaded.");
      } finally {
        if (!cancelled) {
          setStyleLoading(false);
        }
      }
    }

    bootstrapMap();

    return () => {
      cancelled = true;
      if (vehicleFrameRef.current !== null) {
        window.cancelAnimationFrame(vehicleFrameRef.current);
      }
      clearPendingMapRefit();
      vehicleSourceRef.current = null;
      stopSourceRef.current = null;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [clearPendingMapRefit, initialViewport.lat, initialViewport.lon, initialViewport.zoom, scheduleIdleMapRefit, setVehicleBounds, setViewport]);

  useEffect(() => {
    if (!mapReady || !stopSourceRef.current) {
      return;
    }

    const data: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: displayStops.map((stop, index) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [stop.lon, stop.lat],
        },
        properties: {
          gtfsId: stop.gtfsId,
          code: stop.code,
          name: stop.name,
          order: index + 1,
        },
      })),
    };

    stopSourceRef.current.setData(data);

    if (stops.length > 0 && mapRef.current && !setupMode && !editMode) {
      const bounds = getStopBounds(stops);
      const fitKey = getStopFitKey(stops, isStackedLayout, splitStackedSchedules);
      latestStopBoundsRef.current = bounds;

      if (fitKey !== lastAutoFitKeyRef.current) {
        lastAutoFitKeyRef.current = fitKey;
        clearPendingMapRefit();
        fitLatestStopBounds(MAP_INITIAL_FIT_DURATION_MS);
      }
    }
  }, [clearPendingMapRefit, displayStops, editMode, fitLatestStopBounds, isStackedLayout, mapReady, setupMode, splitStackedSchedules, stops]);

  useEffect(() => {
    if (!mapReady || !vehicleSourceRef.current) {
      return;
    }

    const renderVehicles = () => {
      vehicleSourceRef.current?.setData(toVehicleCollection(vehiclesRef.current, Date.now()));
      vehicleFrameRef.current = window.requestAnimationFrame(renderVehicles);
    };

    renderVehicles();

    return () => {
      if (vehicleFrameRef.current !== null) {
        window.cancelAnimationFrame(vehicleFrameRef.current);
        vehicleFrameRef.current = null;
      }
    };
  }, [mapReady]);

  return {
    mapContainerRef,
    mapRef: mapRef as RefObject<MapLibreMap | null>,
    mapReady,
    styleError,
    styleLoading,
    clearPendingMapRefit,
  };
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
