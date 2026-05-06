import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import {
  AlertTriangle,
  Bus,
  Check,
  Copy,
  Crosshair,
  LocateFixed,
  LoaderCircle,
  MapPinned,
  Menu,
  Plus,
  RotateCcw,
  TrainFront,
  TramFront,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchNearbyTramStops,
  fetchStopsWithDepartures,
  type NearbyStopCandidate,
  type StopWithDepartures,
} from "./api/digitransit";
import { cn } from "./lib/cn";
import { loadHslStyle } from "./lib/hslStyle";
import { formatDepartureTime, formatRelativeMinutes } from "./lib/time";
import {
  MAX_STOP_COUNT,
  serializeUrlState,
  type ViewportState,
} from "./lib/urlState";
import {
  clearUserConfig,
  resolveInitialUserConfig,
  saveUserConfig,
} from "./lib/userConfig";
import {
  getVehicleMqttTopics,
  useVehicleStream,
  type VehicleBounds,
  type VehicleSnapshot,
  type VehicleStreamStatus,
} from "./lib/useVehicleStream";

const stopSourceId = "selected-stops";
const vehicleSourceId = "vehicles";
const VEHICLE_TRANSITION_MS = 900;
const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;
const HSL_LABEL_FONT = ["Gotham Rounded Medium"];
const DEPARTURE_EXPIRY_GRACE_MS = 45_000;
const STOP_REFRESH_INTERVAL_MS = 60_000;
const STOP_REFRESH_MIN_INTERVAL_MS = 15_000;
const GEOLOCATION_TIMEOUT_MS = 10_000;
const LOCATION_ZOOM = 15.8;
type LeaderRibbon = {
  id: string;
  svgId: string;
  color: string;
  polygon: string;
  cssPolygon: string;
  stopX: number;
  stopY: number;
  cardX: number;
  cardY: number;
  stopRadius: number;
};

type ScreenPoint = {
  x: number;
  y: number;
};

type Departure = StopWithDepartures["departures"][number];
type EditBaseline = {
  stopIds: string[];
  viewport: ViewportState;
};
type AsyncUiState = "idle" | "loading" | "success" | "error";

export default function App() {
  const initialUserConfig = useMemo(() => resolveInitialUserConfig(window.location.search), []);
  const [viewport, setViewport] = useState<ViewportState>(initialUserConfig.viewport);
  const [stopIds, setStopIds] = useState<string[]>(initialUserConfig.stopIds);
  const [stops, setStops] = useState<StopWithDepartures[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleLoading, setStyleLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [vehicleBounds, setVehicleBounds] = useState<VehicleBounds>(() =>
    getFallbackVehicleBounds(initialUserConfig.viewport),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [setupMode, setSetupMode] = useState(initialUserConfig.stopIds.length === 0);
  const [editMode, setEditMode] = useState(false);
  const [nearbyStops, setNearbyStops] = useState<NearbyStopCandidate[]>([]);
  const [locationStatus, setLocationStatus] = useState<AsyncUiState>("idle");
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [arrangedStopIds, setArrangedStopIds] = useState<string[]>(initialUserConfig.stopIds);
  const [leaderLines, setLeaderLines] = useState<LeaderRibbon[]>([]);
  const [overlaySize, setOverlaySize] = useState({ width: 1, height: 1 });
  const [now, setNow] = useState(() => new Date());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleSourceRef = useRef<GeoJSONSource | null>(null);
  const stopSourceRef = useRef<GeoJSONSource | null>(null);
  const initialViewportRef = useRef(initialUserConfig.viewport);
  const stopIdsRef = useRef(initialUserConfig.stopIds);
  const stopsRef = useRef<StopWithDepartures[]>([]);
  const viewportRef = useRef(initialUserConfig.viewport);
  const setupModeRef = useRef(setupMode);
  const editModeRef = useRef(editMode);
  const editBaselineRef = useRef<EditBaseline>({
    stopIds: initialUserConfig.stopIds,
    viewport: initialUserConfig.viewport,
  });
  const vehicleFrameRef = useRef<number | null>(null);
  const leaderLineFrameRef = useRef<number | null>(null);
  const vehiclesRef = useRef<Map<string, VehicleSnapshot>>(new Map());
  const stopCardRefs = useRef(new Map<string, HTMLElement>());
  const lastStopRefreshAtRef = useRef(0);
  const previousScheduleRowVariantRef = useRef<ScheduleRowVariant>("compact");

  const vehicleMqttTopics = useMemo(
    () => getVehicleMqttTopics(vehicleBounds),
    [vehicleBounds.north, vehicleBounds.south, vehicleBounds.east, vehicleBounds.west],
  );
  const { vehicles, status: vehicleStreamStatus } = useVehicleStream(vehicleMqttTopics);
  const digitransitApiKeyConfigured = Boolean(import.meta.env.VITE_DIGITRANSIT_API_KEY);
  const departureLimit = getDepartureLimit(stopIds.length);
  const activeStops = useMemo(() => filterStopsWithActiveDepartures(stops, now), [stops, now]);
  const isStackedLayout = overlaySize.width < 768;
  const displayStops = useMemo(
    () => orderStopsByIds(activeStops, arrangedStopIds),
    [activeStops, arrangedStopIds],
  );
  const duplicateStopNames = useMemo(() => getDuplicateStopNames(displayStops), [displayStops]);
  const stopBoardLayout = getStopBoardLayout(displayStops.length, isStackedLayout);
  const maxActiveDepartureCount = getMaxDepartureCount(activeStops);
  const scheduleFit = getScheduleFit(
    displayStops.length,
    Math.min(departureLimit, maxActiveDepartureCount),
    isStackedLayout,
    overlaySize,
    previousScheduleRowVariantRef.current,
  );
  previousScheduleRowVariantRef.current = scheduleFit.rowVariant;
  const visibleDepartureCount = scheduleFit.visibleCount;
  const compactSchedule = visibleDepartureCount <= 2;
  const showScheduledTime = scheduleFit.rowVariant === "full";
  const showModeIcon = scheduleFit.rowVariant !== "compact";
  const ultraCompactSchedule = scheduleFit.rowVariant === "compact";
  const denseScheduleHeader = scheduleFit.rowVariant !== "full" || displayStops.length >= 4;
  const emptySchedule = visibleDepartureCount === 0;
  const scheduleScale = scheduleFit.scale;
  const scheduleScaleStyle = getScheduleScaleStyle(scheduleFit, compactSchedule);
  const shareUrl = getShareUrl(viewport, stopIds);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    stopIdsRef.current = stopIds;
  }, [stopIds]);

  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    setArrangedStopIds((current) => mergeArrangedStopIds(current, stops));
  }, [stops]);

  useEffect(() => {
    setupModeRef.current = setupMode;
  }, [setupMode]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
          center: [initialViewportRef.current.lon, initialViewportRef.current.lat],
          zoom: initialViewportRef.current.zoom,
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
        map.on("moveend", updateMapViewport);

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
      if (leaderLineFrameRef.current !== null) {
        window.cancelAnimationFrame(leaderLineFrameRef.current);
      }
      vehicleSourceRef.current = null;
      stopSourceRef.current = null;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    if (stopIds.length === 0) {
      setStops([]);
      setStopsLoading(false);
      return;
    }

    const refreshStops = (showLoading: boolean) => {
      if (showLoading) {
        setStopsLoading(true);
      }
      setStopsError(null);
      lastStopRefreshAtRef.current = Date.now();

      fetchStopsWithDepartures(stopIds, departureLimit)
        .then((result) => {
          if (!cancelled) {
            setStops(result);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setStopsError(error instanceof Error ? error.message : "Stop data request failed.");
          }
        })
        .finally(() => {
          if (!cancelled && showLoading) {
            setStopsLoading(false);
          }
        });
    };

    refreshStops(true);
    intervalId = window.setInterval(() => {
      refreshStops(false);
    }, STOP_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [departureLimit, stopIds]);

  useEffect(() => {
    if (stopIds.length === 0 || stops.length === 0) {
      return;
    }

    const hasUnderfilledVisibleRows = activeStops.some(
      (stop) => stop.departures.length < visibleDepartureCount,
    );
    const canRefresh = Date.now() - lastStopRefreshAtRef.current >= STOP_REFRESH_MIN_INTERVAL_MS;

    if (!hasUnderfilledVisibleRows || !canRefresh) {
      return;
    }

    let cancelled = false;
    lastStopRefreshAtRef.current = Date.now();

    fetchStopsWithDepartures(stopIds, departureLimit)
      .then((result) => {
        if (!cancelled) {
          setStops(result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStopsError(error instanceof Error ? error.message : "Stop data request failed.");
        }
      })

    return () => {
      cancelled = true;
    };
  }, [activeStops, departureLimit, stopIds, stops.length, visibleDepartureCount]);

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
      const bounds = new maplibregl.LngLatBounds(
        [stops[0].lon, stops[0].lat],
        [stops[0].lon, stops[0].lat],
      );

      for (const stop of stops.slice(1)) {
        bounds.extend([stop.lon, stop.lat]);
      }

      mapRef.current.fitBounds(bounds, {
        padding: { top: 72, right: 72, bottom: 72, left: 72 },
        maxZoom: 16.2,
        duration: 900,
      });
    }
  }, [displayStops, editMode, mapReady, setupMode, stops]);

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

  useEffect(() => {
    if (!mapReady || displayStops.length === 0 || !rootRef.current || !mapShellRef.current || !mapRef.current) {
      setLeaderLines([]);
      return;
    }

    const updateLeaderLines = () => {
      if (leaderLineFrameRef.current !== null) {
        return;
      }

      leaderLineFrameRef.current = window.requestAnimationFrame(() => {
        leaderLineFrameRef.current = null;

        const rootRect = rootRef.current?.getBoundingClientRect();
        const mapRect = mapShellRef.current?.getBoundingClientRect();
        const map = mapRef.current;

        if (!rootRect || !mapRect || !map) {
          return;
        }

        const mapIsBelowBoard = mapRect.top >= rootRect.top + rootRect.height * 0.45;
        setArrangedStopIds((current) => getArrangedStopIds(stopsRef.current, map, mapIsBelowBoard, current));

        setOverlaySize({
          width: Math.max(1, Math.ceil(rootRect.width)),
          height: Math.max(1, Math.ceil(rootRect.height)),
        });

        const nextLines: LeaderRibbon[] = displayStops.flatMap((stop, index) => {
          const leaderId = getLeaderId(stop, index);
          const card = stopCardRefs.current.get(leaderId);
          if (!card) {
            return [];
          }

          const cardRect = card.getBoundingClientRect();
          const projected = map.project([stop.lon, stop.lat]);
          const mapLeft = mapRect.left - rootRect.left;
          const mapTop = mapRect.top - rootRect.top;
          const mapWidth = mapRect.width;
          const mapHeight = mapRect.height;
          const cardLeft = cardRect.left - rootRect.left;
          const cardTop = cardRect.top - rootRect.top;
          const cardRight = cardRect.right - rootRect.left;
          const cardBottom = cardRect.bottom - rootRect.top;
          const mapIsToRight = mapLeft >= cardRight - 12;
          const mapIsBelow = mapTop >= cardBottom - 12;
          const ribbonWidths = getLeaderRibbonWidths(stops.length, mapIsBelow, rootRect.width);
          const stopPoint = {
            x: clamp(mapLeft + projected.x, mapLeft + 24, mapLeft + mapWidth - 24),
            y: clamp(mapTop + projected.y, mapTop + 24, mapTop + mapHeight - 24),
          };
          const leader = buildLeaderRibbon({
            stopPoint,
            cardRect: {
              left: cardLeft,
              top: cardTop,
              right: cardRight,
              bottom: cardBottom,
              width: cardRect.width,
              height: cardRect.height,
            },
            mapRect: {
              left: mapLeft,
              top: mapTop,
              width: mapWidth,
              height: mapHeight,
            },
            widths: ribbonWidths,
            isStackedLayout: mapIsBelow || !mapIsToRight,
          });

          return [
            {
              id: leaderId,
              svgId: toSvgId(leaderId),
              color: STOP_MARKER_COLORS[index] ?? "#ffffff",
              ...leader,
            },
          ];
        });

        setLeaderLines(nextLines);
      });
    };

    updateLeaderLines();

    const map = mapRef.current;
    map.on("move", updateLeaderLines);
    map.on("moveend", updateLeaderLines);
    map.on("resize", updateLeaderLines);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateLeaderLines();
          });

    if (resizeObserver && rootRef.current) {
      resizeObserver.observe(rootRef.current);
      resizeObserver.observe(mapShellRef.current);
      for (const card of stopCardRefs.current.values()) {
        resizeObserver.observe(card);
      }
    }

    window.addEventListener("resize", updateLeaderLines);

    return () => {
      map.off("move", updateLeaderLines);
      map.off("moveend", updateLeaderLines);
      map.off("resize", updateLeaderLines);
      window.removeEventListener("resize", updateLeaderLines);
      resizeObserver?.disconnect();
      if (leaderLineFrameRef.current !== null) {
        window.cancelAnimationFrame(leaderLineFrameRef.current);
        leaderLineFrameRef.current = null;
      }
    };
  }, [displayStops, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !editMode) {
      return;
    }

    const map = mapRef.current;
    const addStopFromMapClick = (event: maplibregl.MapMouseEvent) => {
      setEditStatus("Looking for nearby tram stops...");
      fetchNearbyTramStops({
        lat: event.lngLat.lat,
        lon: event.lngLat.lng,
        maxDistance: 450,
        maxResults: 8,
        retryWithWiderRadius: false,
      })
        .then((candidates) => {
          setNearbyStops(candidates);
          const nextCandidate = candidates.find((candidate) => !stopIdsRef.current.includes(candidate.gtfsId));
          if (!nextCandidate) {
            setEditStatus(candidates.length > 0 ? "Those nearby tram stops are already selected." : "No tram stop found at that point.");
            return;
          }

          setStopIds((current) => addStopId(current, nextCandidate.gtfsId));
          setEditStatus(`${formatStopLabel(nextCandidate)} added.`);
        })
        .catch((error: unknown) => {
          setEditStatus(error instanceof Error ? error.message : "Nearby stop lookup failed.");
        });
    };

    map.on("click", addStopFromMapClick);

    return () => {
      map.off("click", addStopFromMapClick);
    };
  }, [editMode, mapReady]);

  const beginEditMode = () => {
    editBaselineRef.current = {
      stopIds,
      viewport,
    };
    setSetupMode(false);
    setEditMode(true);
    setMenuOpen(false);
    setEditStatus("Pan the map, tap a tram stop area, or use nearby suggestions.");
    setShareStatus("idle");
  };

  const beginManualSetup = () => {
    editBaselineRef.current = {
      stopIds: [],
      viewport,
    };
    setSetupMode(false);
    setEditMode(true);
    setEditStatus("Pan the map and tap near tram stops to add them.");
    setShareStatus("idle");
  };

  const useBrowserLocation = async () => {
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

      const candidates = await fetchNearbyTramStops({
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
          ? "Nearest tram stops selected. Review and press Done to save."
          : "No nearby tram stops found. Pan the map and tap near stops to add them.",
      );
    } catch (error) {
      setLocationStatus("error");
      setSetupMode(false);
      setEditMode(true);
      setEditStatus(error instanceof Error ? error.message : "Location unavailable. Choose stops manually.");
    }
  };

  const refreshNearbyStops = async () => {
    const center = mapRef.current?.getCenter();
    const nextViewport = center
      ? {
          lat: round(center.lat, 5),
          lon: round(center.lng, 5),
          zoom: round(mapRef.current?.getZoom() ?? viewport.zoom, 2),
        }
      : viewport;

    setEditStatus("Refreshing nearby tram stops...");
    setShareStatus("idle");

    try {
      const candidates = await fetchNearbyTramStops({
        lat: nextViewport.lat,
        lon: nextViewport.lon,
      });
      setNearbyStops(candidates);
      setEditStatus(candidates.length > 0 ? "Nearby tram stops refreshed." : "No nearby tram stops found.");
    } catch (error) {
      setEditStatus(error instanceof Error ? error.message : "Nearby stop lookup failed.");
    }
  };

  const addNearbyStop = (candidate: NearbyStopCandidate) => {
    setStopIds((current) => addStopId(current, candidate.gtfsId));
    setEditStatus(`${formatStopLabel(candidate)} selected.`);
    setShareStatus("idle");
  };

  const removeSelectedStop = (stopId: string) => {
    setStopIds((current) => current.filter((currentStopId) => currentStopId !== stopId));
    setEditStatus("Stop removed.");
    setShareStatus("idle");
  };

  const saveEdits = () => {
    saveUserConfig({
      stopIds,
      viewport,
    });
    const nextUrl = serializeUrlState({ viewport, stopIds });
    window.history.replaceState({}, "", nextUrl);
    editBaselineRef.current = {
      stopIds,
      viewport,
    };
    setSetupMode(false);
    setEditMode(false);
    setEditStatus(null);
    setShareStatus("idle");
  };

  const cancelEdits = () => {
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
  };

  const copyShareUrl = async () => {
    try {
      if (!navigator.clipboard) {
        setShareStatus("manual");
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("copied");
    } catch {
      setShareStatus("manual");
    }
  };

  const resetChoices = () => {
    clearUserConfig();
    stopIdsRef.current = [];
    setupModeRef.current = true;
    editModeRef.current = false;
    setStopIds([]);
    setStops([]);
    setNearbyStops([]);
    setArrangedStopIds([]);
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
  };

  return (
    <div ref={rootRef} className="relative h-[100dvh] overflow-hidden bg-[#050816] text-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_75%_15%,rgba(14,165,233,0.16),transparent_28%),linear-gradient(120deg,#020617,#0f172a_45%,#08111f)]" />

      <div className="relative z-10 grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 p-3 md:grid-cols-[minmax(24rem,36vw)_minmax(0,1fr)] md:grid-rows-1">
        <section className="relative min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/72 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md">
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent md:block" />
          <div className="flex h-full min-h-0 flex-col p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex items-center overflow-hidden rounded-full border border-emerald-300/25 bg-emerald-400/10 text-[10px] font-medium uppercase tracking-[0.24em] text-emerald-200">
                <div className="inline-flex items-center gap-2 px-3 py-1.5">
                  <MapPinned className="h-3.5 w-3.5" />
                  <span className={cn("h-2 w-2 rounded-full", vehicleStreamStatus === "error" ? "bg-amber-300" : "bg-emerald-300")} />
                  <span>{vehicleStreamStatus === "connected" ? "Online" : vehicleStreamStatus}</span>
                </div>
                <button
                  type="button"
                  aria-label={menuOpen ? "Close menu" : "Open menu"}
                  onClick={() => setMenuOpen((current) => !current)}
                  className="inline-flex h-8 w-8 items-center justify-center border-l border-emerald-100/10 bg-white/[0.04] text-emerald-100 transition hover:bg-white/10"
                >
                  {menuOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
                </button>
              </div>

              <div className="text-right">
                <div className="text-[clamp(2rem,5vw,4rem)] font-semibold leading-none tracking-tight text-white tabular-nums">
                  {formatClockTime(now)}
                </div>
              </div>
            </div>

            {stopsError ? (
              <Notice className="mb-3 border-rose-300/25 bg-rose-500/10 text-rose-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{stopsError}</div>
              </Notice>
            ) : null}

            {styleError ? (
              <Notice className="mb-3 border-rose-300/25 bg-rose-500/10 text-rose-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{styleError}</div>
              </Notice>
            ) : null}

            <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate-400">
              <span>Stops</span>
              <span>
                Up to {MAX_STOP_COUNT}
                {stopsLoading ? " · loading" : ""}
              </span>
            </div>

            {setupMode ? (
              <FirstRunPanel
                locationStatus={locationStatus}
                onUseLocation={useBrowserLocation}
                onChooseOnMap={beginManualSetup}
              />
            ) : editMode ? (
              <EditStopsPanel
                selectedStopIds={stopIds}
                selectedStops={stops}
                nearbyStops={nearbyStops}
                status={editStatus}
                shareStatus={shareStatus}
                shareUrl={shareUrl}
                locationStatus={locationStatus}
                onUseLocation={useBrowserLocation}
                onRefreshNearby={refreshNearbyStops}
                onAddStop={addNearbyStop}
                onRemoveStop={removeSelectedStop}
                onSave={saveEdits}
                onCancel={cancelEdits}
                onCopyLink={copyShareUrl}
                onReset={resetChoices}
              />
            ) : (
              <div
                className="grid min-h-0 flex-1 gap-3"
                style={stopBoardLayout}
              >
                {displayStops.map((stop, index) => (
                  <section
                    key={getLeaderId(stop, index)}
                    data-testid="stop-card"
                    ref={(element) => {
                      const leaderId = getLeaderId(stop, index);
                      if (element) {
                        stopCardRefs.current.set(leaderId, element);
                      } else {
                        stopCardRefs.current.delete(leaderId);
                      }
                    }}
                    className={cn(
                      "relative flex min-h-0 flex-col overflow-hidden border backdrop-blur-xl",
                      ultraCompactSchedule ? "rounded-[1.35rem]" : compactSchedule ? "rounded-[1.5rem]" : "rounded-[1.65rem]",
                      emptySchedule ? "p-1 sm:p-1.5" : ultraCompactSchedule ? "p-2 sm:p-2.5" : compactSchedule ? "p-2.5 sm:p-3" : "p-4",
                    )}
                    style={getStopCardStyle(STOP_MARKER_COLORS[index] ?? "#ffffff")}
                  >
                    <div className={cn("flex items-start gap-3", emptySchedule ? "mb-0" : ultraCompactSchedule ? "mb-1" : compactSchedule ? "mb-2" : "mb-3")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className={cn("uppercase text-slate-300", emptySchedule || denseScheduleHeader ? "hidden" : ultraCompactSchedule ? "text-[8px] tracking-[0.1em]" : compactSchedule ? "text-[9px] tracking-[0.16em]" : "text-[10px] tracking-[0.22em]")}>
                              {stop.code} {stop.vehicleMode ? `· ${stop.vehicleMode}` : ""}
                            </div>
                            <div className={cn("truncate font-semibold text-white", emptySchedule ? "text-[clamp(0.62rem,2.4vw,0.78rem)] leading-none" : denseScheduleHeader ? "text-[clamp(0.76rem,2.4vw,0.95rem)] leading-tight" : ultraCompactSchedule ? "mt-0.5 text-[clamp(0.72rem,2.8vw,0.9rem)] leading-none" : compactSchedule ? "mt-1 text-[clamp(0.86rem,2.6vw,1.05rem)] leading-tight" : "mt-1 text-[clamp(1rem,1.35vw,1.35rem)]")}>
                              {stop.name}
                            </div>
                            {duplicateStopNames.has(stop.name) && !denseScheduleHeader && !emptySchedule ? (
                              <div
                                data-testid="stop-direction-hint"
                                className={cn("truncate text-cyan-100/85", ultraCompactSchedule || denseScheduleHeader ? "mt-0.5 text-[9px] leading-tight" : "mt-1 text-xs leading-4")}
                              >
                                {[stop.code, stop.directionHint ? `toward ${stop.directionHint}` : null].filter(Boolean).join(" · ")}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {stop.desc && !compactSchedule ? (
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">
                            {stop.desc}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div
                      className="grid min-h-0 flex-1"
                      data-testid="departure-list"
                      data-visible-departures={String(visibleDepartureCount)}
                      data-schedule-scale={scheduleScale.toFixed(2)}
                      data-schedule-variant={scheduleFit.rowVariant}
                      style={scheduleScaleStyle}
                    >
                      {stop.departures.slice(0, visibleDepartureCount).map((departure) => (
                        <div
                          key={getDepartureKey(stop.gtfsId, departure)}
                          data-testid="departure-row"
                          className={cn(
                            "departure-row-motion grid min-h-0 overflow-hidden items-center rounded-[var(--schedule-row-radius)] border border-white/10 px-[var(--schedule-row-px)] py-[var(--schedule-row-py)] transition-[opacity,transform] duration-500 ease-out",
                            showModeIcon ? "grid-cols-[auto_minmax(0,1fr)_auto] gap-[var(--schedule-row-gap)]" : "grid-cols-[minmax(0,1fr)_auto] gap-[var(--schedule-row-gap)]",
                          )}
                          style={getStopRowStyle(STOP_MARKER_COLORS[index] ?? "#ffffff")}
                        >
                          {showModeIcon ? (
                            <div data-testid="departure-mode-icon" className="flex h-[var(--schedule-icon-size)] w-[var(--schedule-icon-size)] items-center justify-center rounded-[var(--schedule-icon-radius)] bg-black/20">
                              <ModeIcon mode={departure.routeMode} className="h-[var(--schedule-mode-icon-size)] w-[var(--schedule-mode-icon-size)]" />
                            </div>
                          ) : null}

                          <div className="min-w-0 overflow-hidden">
                            <div className="flex items-end gap-2">
                              <span className="text-[length:var(--schedule-route-size)] font-semibold leading-none text-white">
                                {departure.routeShortName ?? departure.routeMode}
                              </span>
                              <span className="truncate pb-0.5 text-[length:var(--schedule-headsign-size)] text-slate-200">{departure.headsign}</span>
                            </div>
                            {showScheduledTime ? (
                              <div data-testid="departure-scheduled-time" className="mt-[var(--schedule-time-mt)] truncate uppercase text-[length:var(--schedule-time-size)] leading-tight tracking-[var(--schedule-time-tracking)] text-slate-300">
                                {formatDepartureTime(departure.serviceDay, departure.realtimeDeparture)}
                              </div>
                            ) : null}
                          </div>

                          <div className="text-right">
                            <div className="text-[length:var(--schedule-relative-size)] font-semibold leading-none text-white tabular-nums">
                              {formatRelativeMinutes(departure.serviceDay, departure.realtimeDeparture)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </section>

        <main
          ref={mapShellRef}
          className="relative min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/68 shadow-[0_24px_80px_rgba(2,6,23,0.5)]"
        >
          <div ref={mapContainerRef} className="absolute inset-0" />

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-3 py-2 sm:p-3">
            <div
              data-testid="map-attribution"
              className="pointer-events-auto max-w-[calc(100%-1rem)] truncate rounded-md border border-white/5 bg-slate-950/30 px-2 py-0.5 text-center text-[8px] leading-4 text-slate-400/75 backdrop-blur-[2px] sm:max-w-[min(92%,38rem)] sm:rounded-2xl sm:border-white/10 sm:bg-slate-950/68 sm:px-3 sm:py-2 sm:text-[10px] sm:leading-4 sm:text-slate-300 sm:backdrop-blur-md"
            >
              <span className="sm:hidden">HSL Digitransit · © OpenMapTiles · © OSM</span>
              <span className="hidden sm:inline">
                Realtime data: HSL Digitransit | Digitransit data is licensed under CC BY 4.0. |
                {" "}
                © OpenMapTiles © OpenStreetMap contributors
              </span>
            </div>
          </div>

          {(styleLoading || !mapReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-950/85 px-5 py-3 text-sm text-slate-100 shadow-2xl">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Preparing the map
              </div>
            </div>
          )}
        </main>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
        {leaderLines.map((line) => (
          <div
            key={`${line.id}-frost`}
            data-testid="leader-frost"
            className="absolute inset-0"
            style={getLeaderFrostStyle(line)}
          />
        ))}
      </div>

      <svg
        className="pointer-events-none absolute inset-0 z-20 block"
        aria-hidden="true"
        viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
        preserveAspectRatio="none"
      >
        {leaderLines.map((line) => (
          <g key={line.id} data-testid="leader-3d">
            <defs>
              <linearGradient id={`${line.svgId}-deck`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e0faff" stopOpacity="0.18" />
                <stop offset="24%" stopColor={line.color} stopOpacity="0.16" />
                <stop offset="66%" stopColor="#0f3558" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#020617" stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f8fdff" stopOpacity="0.34" />
                <stop offset="22%" stopColor="#7dd3fc" stopOpacity="0.48" />
                <stop offset="64%" stopColor={line.color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={line.color} stopOpacity="0.16" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-highlight`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
                <stop offset="34%" stopColor="#bae6fd" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#bae6fd" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-lower-shadow`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#020617" stopOpacity="0" />
                <stop offset="58%" stopColor="#020617" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#020617" stopOpacity="0.18" />
              </linearGradient>
              <filter id={`${line.svgId}-glow`} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feColorMatrix
                  in="blur"
                  type="matrix"
                  values="0 0 0 0 0.49 0 0 0 0 0.83 0 0 0 0 0.98 0 0 0 0.17 0"
                />
              </filter>
              <filter id={`${line.svgId}-shadow`} x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
                <feDropShadow dx="0" dy="10" stdDeviation="11" floodColor="#020617" floodOpacity="0.26" />
              </filter>
              <clipPath id={`${line.svgId}-clip`}>
                <polygon points={line.polygon} />
              </clipPath>
            </defs>
            <polygon
              data-testid="leader-glow"
              points={line.polygon}
              fill="none"
              stroke={withAlpha("#7dd3fc", 0.2)}
              strokeWidth="4"
              strokeLinejoin="round"
              filter={`url(#${line.svgId}-glow)`}
            />
            <polygon
              data-testid="leader-soft-shadow"
              points={line.polygon}
              fill={withAlpha("#020617", 0.12)}
              stroke="none"
              filter={`url(#${line.svgId}-shadow)`}
            />
            <polygon
              data-testid="leader-ribbon"
              points={line.polygon}
              fill={`url(#${line.svgId}-deck)`}
              stroke={`url(#${line.svgId}-rim)`}
              strokeWidth="1"
              strokeLinejoin="round"
              opacity="0.72"
            />
            <polygon
              data-testid="leader-inner-shadow"
              points={line.polygon}
              fill={`url(#${line.svgId}-lower-shadow)`}
              stroke="none"
              clipPath={`url(#${line.svgId}-clip)`}
              opacity="0.86"
            />
            <polygon
              data-testid="leader-highlight"
              points={line.polygon}
              fill="none"
              stroke={`url(#${line.svgId}-highlight)`}
              strokeWidth="0.45"
              strokeLinejoin="round"
              opacity="0.72"
            />
            <circle
              data-testid="leader-stop-cap"
              cx={line.stopX}
              cy={line.stopY}
              r={line.stopRadius}
              fill={line.color}
              stroke="#ffffff"
              strokeWidth="1.5"
              opacity="0.92"
            />
          </g>
        ))}
      </svg>

      {menuOpen ? (
        <div className="absolute left-4 top-[4.75rem] z-30 w-[min(24rem,calc(100vw-2rem))] rounded-[1.6rem] border border-white/10 bg-slate-950/92 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur-xl md:left-5 md:top-[5.25rem]">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            Screen details
          </div>

          <div className="grid gap-3">
            <InfoRow label="Realtime" value={formatVehicleStreamStatus(vehicleStreamStatus)} />
            <InfoRow label="Vehicles" value={String(vehicles.size)} />
            <InfoRow
              label="Viewport"
              value={`${viewport.lat.toFixed(4)}, ${viewport.lon.toFixed(4)} · z${viewport.zoom.toFixed(2)}`}
            />
            <InfoRow
              label="Stops"
              value={stopIds.length > 0 ? stopIds.join(", ") : "None"}
            />
            <InfoRow
              label="URL"
              value={shareUrl}
              multiline
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={beginEditMode}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/16"
            >
              <MapPinned className="h-4 w-4" />
              Edit stops
            </button>
            <button
              type="button"
              onClick={copyShareUrl}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
            >
              {shareStatus === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {shareStatus === "copied" ? "Copied" : "Copy link"}
            </button>
          </div>

          <button
            type="button"
            data-testid="reset-choices"
            onClick={resetChoices}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-50 transition hover:bg-amber-300/16"
          >
            <RotateCcw className="h-4 w-4" />
            Reset choices
          </button>

          {shareStatus === "manual" ? (
            <input
              readOnly
              value={shareUrl}
              className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200"
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : null}

          {!digitransitApiKeyConfigured ? (
            <Notice className="mt-4 border-amber-300/30 bg-amber-400/10 text-amber-50">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Digitransit subscription key not configured.</p>
                <p className="text-amber-100/80">
                  Set <code className="font-mono">VITE_DIGITRANSIT_API_KEY</code> for reliable map tiles and
                  GraphQL access.
                </p>
              </div>
            </Notice>
          ) : null}

          {vehicleStreamStatus === "error" ? (
            <Notice className="mt-4 border-amber-300/30 bg-amber-400/10 text-amber-50">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>Realtime feed unavailable in this browser session.</div>
            </Notice>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function InfoRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={cn("mt-1 text-sm text-slate-100", multiline ? "break-all" : "truncate")}>{value}</div>
    </div>
  );
}

function Notice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex gap-3 rounded-3xl border p-4 text-sm leading-6", className)}>{children}</div>;
}

function FirstRunPanel({
  locationStatus,
  onUseLocation,
  onChooseOnMap,
}: {
  locationStatus: AsyncUiState;
  onUseLocation: () => void;
  onChooseOnMap: () => void;
}) {
  const locating = locationStatus === "loading";

  return (
    <div
      data-testid="first-run-panel"
      className="flex min-h-0 flex-1 flex-col justify-center rounded-[1.6rem] border border-cyan-200/15 bg-white/[0.04] p-4 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] sm:p-5"
    >
      <div className="mb-4">
        <div className="text-lg font-semibold text-white">Set up nearby tram stops</div>
        <div className="mt-2 max-w-[30rem] text-sm leading-6 text-slate-300">
          Use your location to select nearby tram stops, or choose stops from the map.
        </div>
      </div>

      <div className="grid gap-2">
        <button
          type="button"
          data-testid="setup-use-location"
          onClick={onUseLocation}
          disabled={locating}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/25 bg-cyan-300/12 px-4 py-3 font-medium text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-wait disabled:opacity-70"
        >
          {locating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          {locating ? "Finding location" : "Use location"}
        </button>
        <button
          type="button"
          data-testid="setup-choose-map"
          onClick={onChooseOnMap}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-medium text-slate-100 transition hover:bg-white/10"
        >
          <MapPinned className="h-4 w-4" />
          Choose on map
        </button>
      </div>

      {locationStatus === "error" ? (
        <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-50">
          Location was unavailable. You can still choose stops from the map.
        </div>
      ) : null}
    </div>
  );
}

function EditStopsPanel({
  selectedStopIds,
  selectedStops,
  nearbyStops,
  status,
  shareStatus,
  shareUrl,
  locationStatus,
  onUseLocation,
  onRefreshNearby,
  onAddStop,
  onRemoveStop,
  onSave,
  onCancel,
  onCopyLink,
  onReset,
}: {
  selectedStopIds: string[];
  selectedStops: StopWithDepartures[];
  nearbyStops: NearbyStopCandidate[];
  status: string | null;
  shareStatus: "idle" | "copied" | "manual";
  shareUrl: string;
  locationStatus: AsyncUiState;
  onUseLocation: () => void;
  onRefreshNearby: () => void;
  onAddStop: (candidate: NearbyStopCandidate) => void;
  onRemoveStop: (stopId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onCopyLink: () => void;
  onReset: () => void;
}) {
  const selectedStopMap = new Map(selectedStops.map((stop) => [stop.gtfsId, stop]));
  const canAddMore = selectedStopIds.length < MAX_STOP_COUNT;
  const locating = locationStatus === "loading";

  return (
    <div
      data-testid="edit-stops-panel"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[1.6rem] border border-cyan-200/15 bg-white/[0.04] p-3 text-sm text-slate-200 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-white">Edit stops</div>
          <div className="mt-1 text-xs leading-5 text-slate-400">Tap the map near a tram stop or add a nearby suggestion.</div>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
          {selectedStopIds.length}/{MAX_STOP_COUNT}
        </div>
      </div>

      <div className="grid min-h-0 gap-3 overflow-auto pr-1">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">Selected</div>
          <div className="grid gap-2" data-testid="edit-selected-stops">
            {selectedStopIds.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-3 py-3 text-xs leading-5 text-slate-400">
                No stops selected yet.
              </div>
            ) : (
              selectedStopIds.map((stopId) => {
                const stop = selectedStopMap.get(stopId);
                return (
                  <div key={stopId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{stop?.name ?? stopId}</div>
                      <div className="truncate text-xs text-slate-400">{stop?.code ?? stopId}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${stop?.name ?? stopId}`}
                      onClick={() => onRemoveStop(stopId)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200/15 bg-rose-300/10 text-rose-100 transition hover:bg-rose-300/16"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Nearby</div>
            <button
              type="button"
              data-testid="edit-refresh-nearby"
              onClick={onRefreshNearby}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:bg-white/10"
            >
              <Crosshair className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
          <div className="grid gap-2" data-testid="edit-nearby-stops">
            {nearbyStops.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-3 py-3 text-xs leading-5 text-slate-400">
                No nearby suggestions loaded.
              </div>
            ) : (
              nearbyStops.map((candidate) => {
                const selected = selectedStopIds.includes(candidate.gtfsId);
                return (
                  <button
                    key={candidate.gtfsId}
                    type="button"
                    disabled={selected || !canAddMore}
                    onClick={() => onAddStop(candidate)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-left transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-white">{formatStopLabel(candidate)}</span>
                      <span className="block truncate text-xs text-slate-400">{formatDistance(candidate.distance)} away</span>
                    </span>
                    <Plus className="h-4 w-4 text-cyan-200" />
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {status ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-2 text-xs leading-5 text-slate-300">
          {status}
        </div>
      ) : null}

      {shareStatus === "manual" ? (
        <input
          readOnly
          value={shareUrl}
          className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-xs text-slate-200"
          onFocus={(event) => event.currentTarget.select()}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onUseLocation}
          disabled={locating}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
        >
          {locating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          Location
        </button>
        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
        >
          {shareStatus === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {shareStatus === "copied" ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="edit-reset-choices"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200/20 bg-amber-300/10 px-3 py-2 text-xs font-medium text-amber-50 transition hover:bg-amber-300/16"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
        <button
          type="button"
          data-testid="edit-save"
          onClick={onSave}
          disabled={selectedStopIds.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/25 bg-cyan-300/12 px-3 py-2 text-xs font-medium text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          Done
        </button>
      </div>
    </div>
  );
}

function ModeIcon({ mode, className }: { mode: string; className?: string }) {
  if (mode === "TRAM") {
    return <TramFront className={cn("h-4 w-4 text-blue-300", className)} />;
  }

  if (mode === "RAIL" || mode === "SUBWAY") {
    return <TrainFront className={cn("h-4 w-4 text-violet-300", className)} />;
  }

  return <Bus className={cn("h-4 w-4 text-emerald-300", className)} />;
}

function toVehicleCollection(
  vehicles: Map<string, VehicleSnapshot>,
  now: number,
): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = Array.from(vehicles.values()).map((vehicle) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: interpolateCoordinates(vehicle, now),
    },
    properties: {
      id: vehicle.id,
      mode: vehicle.mode,
      label: vehicle.label,
      headsign: vehicle.headsign,
      bearing: interpolateHeading(vehicle, now),
    },
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

function interpolateCoordinates(vehicle: VehicleSnapshot, now: number): [number, number] {
  const progress = getVehicleTransitionProgress(vehicle, now);
  return [
    lerp(vehicle.previousLon, vehicle.lon, progress),
    lerp(vehicle.previousLat, vehicle.lat, progress),
  ];
}

function interpolateHeading(vehicle: VehicleSnapshot, now: number) {
  const progress = getVehicleTransitionProgress(vehicle, now);
  const delta = ((((vehicle.heading - vehicle.previousHeading) % 360) + 540) % 360) - 180;
  return (vehicle.previousHeading + delta * progress + 360) % 360;
}

function getVehicleTransitionProgress(vehicle: VehicleSnapshot, now: number) {
  const elapsed = now - vehicle.transitionStartedAt;
  return clamp(elapsed / VEHICLE_TRANSITION_MS, 0, 1);
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatVehicleStreamStatus(status: VehicleStreamStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    default:
      return status;
  }
}

function getFallbackVehicleBounds(viewport: ViewportState): VehicleBounds {
  return {
    north: viewport.lat + 0.01,
    south: viewport.lat - 0.01,
    east: viewport.lon + 0.01,
    west: viewport.lon - 0.01,
  };
}

function formatClockTime(value: Date) {
  return new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function getBrowserLocation(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available in this browser. Choose stops manually."));
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
        reject(new Error("Location permission was denied or unavailable. Choose stops manually."));
      },
      {
        enableHighAccuracy: true,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: 60_000,
      },
    );
  });
}

function addStopId(stopIds: string[], stopId: string) {
  if (stopIds.includes(stopId) || stopIds.length >= MAX_STOP_COUNT) {
    return stopIds;
  }

  return [...stopIds, stopId].slice(0, MAX_STOP_COUNT);
}

function formatStopLabel(stop: Pick<NearbyStopCandidate, "code" | "name">) {
  return [stop.code, stop.name].filter(Boolean).join(" ");
}

function formatDistance(distance: number) {
  if (!Number.isFinite(distance)) {
    return "nearby";
  }

  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(1)} km`;
  }

  return `${Math.round(distance)} m`;
}

function getShareUrl(viewport: ViewportState, stopIds: string[]) {
  return new URL(serializeUrlState({ viewport, stopIds }), window.location.href).toString();
}

function getDepartureLimit(stopCount: number) {
  if (stopCount >= 4) {
    return 6;
  }

  if (stopCount === 3) {
    return 7;
  }

  if (stopCount === 2) {
    return 8;
  }

  return 9;
}

function filterStopsWithActiveDepartures(stops: StopWithDepartures[], now: Date): StopWithDepartures[] {
  return stops.map((stop) => ({
    ...stop,
    departures: stop.departures.filter((departure) => !isDepartureExpired(departure, now)),
  }));
}

function orderStopsByIds(stops: StopWithDepartures[], orderedIds: string[]) {
  if (orderedIds.length === 0) {
    return stops;
  }

  const order = new Map(orderedIds.map((stopId, index) => [stopId, index]));
  return [...stops].sort(
    (a, b) => (order.get(a.gtfsId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.gtfsId) ?? Number.MAX_SAFE_INTEGER),
  );
}

function mergeArrangedStopIds(current: string[], stops: StopWithDepartures[]) {
  const stopIds = stops.map((stop) => stop.gtfsId);
  const next = [
    ...current.filter((stopId) => stopIds.includes(stopId)),
    ...stopIds.filter((stopId) => !current.includes(stopId)),
  ];

  return sameStringList(current, next) ? current : next;
}

function getArrangedStopIds(
  stops: StopWithDepartures[],
  map: MapLibreMap,
  isStackedLayout: boolean,
  current: string[],
) {
  if (stops.length <= 1) {
    return mergeArrangedStopIds(current, stops);
  }

  const next = [...stops]
    .sort((a, b) => {
      const aPoint = map.project([a.lon, a.lat]);
      const bPoint = map.project([b.lon, b.lat]);
      const primaryDelta = isStackedLayout ? aPoint.x - bPoint.x : aPoint.y - bPoint.y;
      if (Math.abs(primaryDelta) > 1) {
        return primaryDelta;
      }

      return isStackedLayout ? aPoint.y - bPoint.y : aPoint.x - bPoint.x;
    })
    .map((stop) => stop.gtfsId);

  return sameStringList(current, next) ? current : next;
}

function sameStringList(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isDepartureExpired(departure: Departure, now: Date) {
  return getDepartureTimestamp(departure) + DEPARTURE_EXPIRY_GRACE_MS < now.getTime();
}

function getDepartureTimestamp(departure: Departure) {
  return (departure.serviceDay + departure.realtimeDeparture) * 1000;
}

function getMaxDepartureCount(stops: StopWithDepartures[]) {
  return stops.reduce((max, stop) => Math.max(max, stop.departures.length), 0);
}

function getDuplicateStopNames(stops: StopWithDepartures[]) {
  const counts = new Map<string, number>();
  for (const stop of stops) {
    counts.set(stop.name, (counts.get(stop.name) ?? 0) + 1);
  }

  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
}

function getDepartureKey(stopId: string, departure: Departure) {
  return [
    stopId,
    departure.serviceDay,
    departure.scheduledDeparture,
    departure.realtimeDeparture,
    departure.routeShortName ?? departure.routeMode,
    departure.headsign,
  ].join("-");
}

type ScheduleRowVariant = "full" | "compactIcon" | "compact";

type ScheduleFit = {
  visibleCount: number;
  scale: number;
  contentScale: number;
  rowVariant: ScheduleRowVariant;
  rowHeight: number;
};

function getScheduleFit(
  stopCount: number,
  maxDepartureCount: number,
  isStackedLayout: boolean,
  screenSize: { width: number; height: number },
  previousRowVariant: ScheduleRowVariant,
): ScheduleFit {
  const minScale = 0.72;
  const maxScale = 1.16;
  const minComfortInset = 8;
  const boardHeight = isStackedLayout ? screenSize.height * 0.42 : screenSize.height - 132;
  const layoutRows = isStackedLayout ? (stopCount <= 2 ? 1 : 2) : Math.max(stopCount, 1);
  const cardHeight = boardHeight / Math.max(layoutRows, 1) - getScheduleCardSafetyReserve(stopCount, isStackedLayout);
  const maxCandidate = Math.max(0, maxDepartureCount);
  const widthScale = screenSize.width < 390 ? 0.82 : screenSize.width < 430 ? 0.88 : screenSize.width < 640 ? 0.94 : 1;
  const variants = getScheduleVariantPriority(isStackedLayout, screenSize.height, previousRowVariant);

  if (stopCount >= 3 && isStackedLayout && cardHeight < 112) {
    return {
      visibleCount: 0,
      scale: minScale,
      contentScale: minScale,
      rowVariant: "compact",
      rowHeight: 0,
    };
  }

  for (let visibleCount = maxCandidate; visibleCount >= 1; visibleCount -= 1) {
    const headerReserve = getScheduleHeaderReserve(stopCount, visibleCount);
    const rowGap = getScheduleBaseListGap(visibleCount);
    const rowBudget = (cardHeight - headerReserve - rowGap * Math.max(0, visibleCount - 1)) / visibleCount;
    const targetRowHeight = getScheduleTargetRowHeight(visibleCount);
    const rowHeight = Math.min(rowBudget, targetRowHeight * maxScale);
    const scale = clamp(rowHeight / targetRowHeight, minScale, maxScale);
    const contentScale = clamp(scale * widthScale, minScale, Math.min(maxScale, 0.98));

    for (const rowVariant of variants) {
      if (rowBudget >= getScheduleMinimumRowHeight(visibleCount, rowVariant, minComfortInset)) {
        return {
          visibleCount,
          scale,
          contentScale,
          rowVariant,
          rowHeight,
        };
      }
    }
  }

  return {
    visibleCount: maxCandidate > 0 && cardHeight >= 74 ? 1 : 0,
    scale: minScale,
    contentScale: minScale,
    rowVariant: "compact",
    rowHeight: maxCandidate > 0 && cardHeight >= 74 ? Math.max(38, Math.min(cardHeight - getScheduleHeaderReserve(stopCount, 1), getScheduleTargetRowHeight(1))) : 0,
  };
}

function getScheduleVariantPriority(
  isStackedLayout: boolean,
  screenHeight: number,
  previousRowVariant: ScheduleRowVariant,
): ScheduleRowVariant[] {
  if (!isStackedLayout) {
    return ["full", "compactIcon", "compact"];
  }

  if (screenHeight < 720) {
    return ["compact"];
  }

  if (screenHeight >= 760 || previousRowVariant === "compactIcon" || previousRowVariant === "full") {
    return ["compactIcon", "compact"];
  }

  return ["compact"];
}

function getScheduleScaleStyle(
  fit: ScheduleFit,
  compactSchedule: boolean,
): CSSProperties {
  const { scale, contentScale, rowVariant, rowHeight, visibleCount } = fit;
  const hasIcon = rowVariant !== "compact";
  const rowPadX = hasIcon ? (compactSchedule ? 9 : 12) : 10;
  const rowPadY = hasIcon ? (compactSchedule ? 9 : 13) : 9;
  const iconSize = compactSchedule ? 32 : 48;
  const modeIconSize = compactSchedule ? 20 : 28;
  const rowGap = hasIcon ? (compactSchedule ? 8 : 12) : 8;
  const listGap = hasIcon ? (compactSchedule ? 6 : 8) : 6;
  const comfortableIconSize = Math.max(0, rowHeight - 16);
  const resolvedIconSize = Math.min(Math.max(24, Math.round(iconSize * contentScale)), comfortableIconSize);
  const maxRowRadius = rowVariant === "compact" ? 14 : compactSchedule ? 16 : 18;

  return {
    gap: `${Math.max(3, Math.round(listGap * scale))}px`,
    gridTemplateRows: visibleCount > 0 ? `repeat(${visibleCount}, var(--schedule-row-height))` : undefined,
    alignContent: "space-between",
    "--schedule-row-gap": `${Math.max(5, Math.round(rowGap * scale))}px`,
    "--schedule-row-px": `${Math.max(8, Math.round(rowPadX * scale))}px`,
    "--schedule-row-py": `${Math.max(8, Math.round(rowPadY * scale))}px`,
    "--schedule-row-radius": `${Math.max(10, Math.min(maxRowRadius, Math.round(rowHeight * 0.3)))}px`,
    "--schedule-icon-radius": `${Math.max(10, Math.round(16 * contentScale))}px`,
    "--schedule-icon-size": `${Math.round(resolvedIconSize)}px`,
    "--schedule-mode-icon-size": `${Math.max(16, Math.round(modeIconSize * contentScale))}px`,
    "--schedule-route-size": `${(hasIcon ? (compactSchedule ? 1.18 * contentScale : 1.72 * contentScale) : 1.0 * contentScale).toFixed(3)}rem`,
    "--schedule-headsign-size": `${(hasIcon ? (compactSchedule ? 0.75 * contentScale : 0.9 * contentScale) : 0.68 * contentScale).toFixed(3)}rem`,
    "--schedule-time-size": `${(compactSchedule ? 0.62 * contentScale : 0.75 * contentScale).toFixed(3)}rem`,
    "--schedule-relative-size": `${(hasIcon ? (compactSchedule ? 1.32 * contentScale : 2.0 * contentScale) : 1.02 * contentScale).toFixed(3)}rem`,
    "--schedule-time-mt": `${Math.max(2, Math.round(4 * contentScale))}px`,
    "--schedule-time-tracking": compactSchedule ? "0.12em" : "0.18em",
    "--schedule-row-height": `${Math.max(38, Math.round(rowHeight))}px`,
  } as CSSProperties;
}

function getScheduleHeaderReserve(stopCount: number, visibleCount: number) {
  if (visibleCount <= 1) {
    return stopCount >= 3 ? 38 : 44;
  }

  return stopCount >= 3 ? 50 : 66;
}

function getScheduleCardSafetyReserve(stopCount: number, isStackedLayout: boolean) {
  if (isStackedLayout) {
    return stopCount >= 3 ? 20 : 14;
  }

  return stopCount >= 3 ? 24 : 18;
}

function getScheduleBaseListGap(visibleCount: number) {
  if (visibleCount <= 1) {
    return 4;
  }

  return visibleCount <= 2 ? 7 : 10;
}

function getScheduleTargetRowHeight(visibleCount: number) {
  if (visibleCount <= 1) {
    return 54;
  }

  return visibleCount <= 2 ? 62 : 74;
}

function getScheduleMinimumRowHeight(
  visibleCount: number,
  rowVariant: ScheduleRowVariant,
  minComfortInset: number,
) {
  if (rowVariant === "full") {
    return (visibleCount <= 2 ? 44 : 48) + minComfortInset * 2;
  }

  if (rowVariant === "compactIcon") {
    return (visibleCount <= 2 ? 28 : 30) + minComfortInset * 2;
  }

  return 22 + minComfortInset * 2;
}

function getStopBoardLayout(stopCount: number, isStackedLayout: boolean) {
  if (!isStackedLayout) {
    return {
      gridTemplateRows: `repeat(${Math.max(stopCount, 1)}, minmax(0, 1fr))`,
    };
  }

  if (stopCount <= 1) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }

  if (stopCount === 2) {
    return {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }

  return {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
  };
}

function getLeaderId(stop: StopWithDepartures, index: number) {
  return `${stop.gtfsId}-${index}`;
}

function toSvgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getLeaderRibbonWidths(stopCount: number, isStackedLayout: boolean, screenWidth: number) {
  const densityScale = stopCount >= 3 ? 0.72 : 1;
  const screenScale = screenWidth < 520 ? 0.56 : screenWidth < 768 ? 0.68 : 1;
  const layoutScale = isStackedLayout ? 0.76 : 1;
  const scale = densityScale * screenScale * layoutScale;

  return {
    start: Math.max(12, Math.round(22 * scale)),
    end: Math.max(28, Math.round(96 * scale)),
  };
}

function buildLeaderRibbon({
  stopPoint,
  cardRect,
  mapRect,
  widths,
  isStackedLayout,
}: {
  stopPoint: ScreenPoint;
  cardRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  mapRect: { left: number; top: number; width: number; height: number };
  widths: { start: number; end: number };
  isStackedLayout: boolean;
}) {
  const cardAnchor = isStackedLayout
    ? {
        x: cardRect.left + cardRect.width * 0.5,
        y: cardRect.bottom,
      }
    : {
        x: cardRect.right,
        y: cardRect.top + cardRect.height * 0.5,
      };

  const spinePoints = isStackedLayout
    ? buildStackedLeaderSpine(stopPoint, cardAnchor, mapRect)
    : buildDesktopLeaderSpine(stopPoint, cardAnchor);
  const ribbonPoints = buildRibbonPolygonPoints(
    spinePoints,
    spinePoints.map((_, index) => {
      if (index === 0) {
        return widths.start;
      }

      if (index === spinePoints.length - 1) {
        return widths.end;
      }

      return widths.end * 0.74;
    }),
  );

  return {
    polygon: toPolygonPoints(ribbonPoints),
    cssPolygon: toCssPolygonPoints(ribbonPoints),
    stopX: stopPoint.x,
    stopY: stopPoint.y,
    cardX: cardAnchor.x,
    cardY: cardAnchor.y,
    stopRadius: Math.max(4, widths.start * 0.34),
  };
}

function buildDesktopLeaderSpine(stopPoint: ScreenPoint, cardAnchor: ScreenPoint) {
  const dropX = cardAnchor.x + 56;

  return [
    stopPoint,
    { x: dropX, y: cardAnchor.y },
    cardAnchor,
  ];
}

function buildStackedLeaderSpine(
  stopPoint: ScreenPoint,
  cardAnchor: ScreenPoint,
  mapRect: { left: number; top: number; width: number },
) {
  const dropY = Math.max(cardAnchor.y + 44, mapRect.top + 10);

  return [
    stopPoint,
    { x: cardAnchor.x, y: dropY },
    cardAnchor,
  ];
}

function getStopCardStyle(color: string) {
  return {
    borderColor: withAlpha(color, 0.46),
    background: [
      `linear-gradient(145deg, ${withAlpha("#ffffff", 0.16)}, transparent 24%)`,
      `linear-gradient(155deg, ${withAlpha(color, 0.32)}, ${withAlpha(color, 0.12)} 44%, rgba(2, 6, 23, 0.7) 100%)`,
    ].join(", "),
    boxShadow: [
      `inset 0 1px 0 ${withAlpha("#ffffff", 0.28)}`,
      `inset 0 -22px 42px ${withAlpha("#020617", 0.34)}`,
      `0 28px 70px rgba(2, 6, 23, 0.46)`,
      `0 0 42px ${withAlpha(color, 0.14)}`,
    ].join(", "),
  };
}

function getStopRowStyle(color: string) {
  return {
    borderColor: withAlpha(color, 0.28),
    background: [
      `linear-gradient(140deg, ${withAlpha("#ffffff", 0.12)}, transparent 28%)`,
      `linear-gradient(135deg, ${withAlpha(color, 0.18)}, rgba(2, 6, 23, 0.46) 68%)`,
    ].join(", "),
    boxShadow: `inset 0 1px 0 ${withAlpha("#ffffff", 0.14)}, 0 12px 30px rgba(2, 6, 23, 0.22)`,
  };
}

function getLeaderFrostStyle(line: LeaderRibbon) {
  return {
    clipPath: `polygon(${line.cssPolygon})`,
    WebkitClipPath: `polygon(${line.cssPolygon})`,
    backdropFilter: "blur(5px) saturate(1.16)",
    WebkitBackdropFilter: "blur(5px) saturate(1.16)",
    background: [
      `linear-gradient(135deg, ${withAlpha("#e0faff", 0.12)}, ${withAlpha(line.color, 0.1)} 40%, ${withAlpha("#020617", 0.18)} 100%)`,
      `linear-gradient(45deg, ${withAlpha("#7dd3fc", 0.08)}, ${withAlpha("#0f172a", 0.12)})`,
    ].join(", "),
    boxShadow: [
      `0 0 4px ${withAlpha("#7dd3fc", 0.12)}`,
      `inset 0 1px 0 ${withAlpha("#ffffff", 0.14)}`,
      `inset 0 -12px 24px ${withAlpha("#020617", 0.16)}`,
    ].join(", "),
  } as CSSProperties;
}

function buildRibbonPolygonPoints(
  points: ScreenPoint[],
  widths: number[],
) {
  if (points.length < 2) {
    return [];
  }

  const left: ScreenPoint[] = [];
  const right: ScreenPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const halfWidth = (widths[index] ?? widths[widths.length - 1] ?? 0) / 2;

    if (index === 0) {
      const normal = getSegmentNormal(points[0], points[1]);
      left.push(offsetPoint(point, normal, halfWidth));
      right.push(offsetPoint(point, normal, -halfWidth));
      continue;
    }

    if (index === points.length - 1) {
      const normal = getSegmentNormal(points[index - 1], point);
      left.push(offsetPoint(point, normal, halfWidth));
      right.push(offsetPoint(point, normal, -halfWidth));
      continue;
    }

    left.push(getJoinedOffsetPoint(points[index - 1], point, points[index + 1], halfWidth));
    right.push(getJoinedOffsetPoint(points[index - 1], point, points[index + 1], -halfWidth));
  }

  return [...left, ...right.reverse()];
}

function getJoinedOffsetPoint(prev: ScreenPoint, point: ScreenPoint, next: ScreenPoint, offset: number) {
  const incomingNormal = getSegmentNormal(prev, point);
  const outgoingNormal = getSegmentNormal(point, next);
  const incomingStart = offsetPoint(prev, incomingNormal, offset);
  const incomingEnd = offsetPoint(point, incomingNormal, offset);
  const outgoingStart = offsetPoint(point, outgoingNormal, offset);
  const outgoingEnd = offsetPoint(next, outgoingNormal, offset);

  return getLineIntersection(incomingStart, incomingEnd, outgoingStart, outgoingEnd) ?? outgoingStart;
}

function getSegmentNormal(start: ScreenPoint, end: ScreenPoint) {
  const tangent = normalize({
    x: end.x - start.x,
    y: end.y - start.y,
  });

  return {
    x: -tangent.y,
    y: tangent.x,
  };
}

function offsetPoint(point: ScreenPoint, normal: ScreenPoint, offset: number) {
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset,
  };
}

function getLineIntersection(a1: ScreenPoint, a2: ScreenPoint, b1: ScreenPoint, b2: ScreenPoint) {
  const aDx = a2.x - a1.x;
  const aDy = a2.y - a1.y;
  const bDx = b2.x - b1.x;
  const bDy = b2.y - b1.y;
  const denominator = aDx * bDy - aDy * bDx;

  if (Math.abs(denominator) < 0.001) {
    return null;
  }

  const progress = ((b1.x - a1.x) * bDy - (b1.y - a1.y) * bDx) / denominator;

  return {
    x: a1.x + progress * aDx,
    y: a1.y + progress * aDy,
  };
}

function toPolygonPoints(points: ScreenPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function toCssPolygonPoints(points: ScreenPoint[]) {
  return points.map((point) => `${point.x}px ${point.y}px`).join(", ");
}

function normalize(vector: { x: number; y: number }) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) {
    return { x: 0, y: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return hex;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
