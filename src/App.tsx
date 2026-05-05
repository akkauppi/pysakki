import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import {
  AlertTriangle,
  Bus,
  LoaderCircle,
  MapPinned,
  Menu,
  TrainFront,
  TramFront,
  X,
} from "lucide-react";
import { fetchStopsWithDepartures, type StopWithDepartures } from "./api/digitransit";
import { cn } from "./lib/cn";
import { loadHslStyle } from "./lib/hslStyle";
import { formatDepartureTime, formatRelativeMinutes } from "./lib/time";
import {
  MAX_STOP_COUNT,
  parseUrlState,
  serializeUrlState,
  type ViewportState,
} from "./lib/urlState";
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
type LeaderRibbon = {
  id: string;
  svgId: string;
  color: string;
  polygon: string;
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

export default function App() {
  const initialUrlState = useMemo(() => parseUrlState(window.location.search), []);
  const [viewport, setViewport] = useState<ViewportState>(initialUrlState.viewport);
  const [stops, setStops] = useState<StopWithDepartures[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleLoading, setStyleLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [vehicleBounds, setVehicleBounds] = useState<VehicleBounds>(() =>
    getFallbackVehicleBounds(initialUrlState.viewport),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaderLines, setLeaderLines] = useState<LeaderRibbon[]>([]);
  const [overlaySize, setOverlaySize] = useState({ width: 1, height: 1 });
  const [now, setNow] = useState(() => new Date());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleSourceRef = useRef<GeoJSONSource | null>(null);
  const stopSourceRef = useRef<GeoJSONSource | null>(null);
  const initialViewportRef = useRef(initialUrlState.viewport);
  const stopIdsRef = useRef(initialUrlState.stopIds);
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
  const departureLimit = getDepartureLimit(initialUrlState.stopIds.length);
  const activeStops = useMemo(() => filterStopsWithActiveDepartures(stops, now), [stops, now]);
  const isStackedLayout = overlaySize.width < 768;
  const stopBoardLayout = getStopBoardLayout(stops.length, isStackedLayout);
  const maxActiveDepartureCount = getMaxDepartureCount(activeStops);
  const scheduleFit = getScheduleFit(
    stops.length,
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
  const denseScheduleHeader = scheduleFit.rowVariant !== "full" || stops.length >= 4;
  const emptySchedule = visibleDepartureCount === 0;
  const scheduleScale = scheduleFit.scale;
  const scheduleScaleStyle = getScheduleScaleStyle(scheduleFit, compactSchedule);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

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

          window.history.replaceState({}, "", nextUrl);
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

    if (initialUrlState.stopIds.length === 0) {
      setStops([]);
      return;
    }

    const refreshStops = (showLoading: boolean) => {
      if (showLoading) {
        setStopsLoading(true);
      }
      setStopsError(null);
      lastStopRefreshAtRef.current = Date.now();

      fetchStopsWithDepartures(initialUrlState.stopIds, departureLimit)
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
  }, [departureLimit, initialUrlState.stopIds]);

  useEffect(() => {
    if (initialUrlState.stopIds.length === 0 || stops.length === 0) {
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

    fetchStopsWithDepartures(initialUrlState.stopIds, departureLimit)
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
  }, [activeStops, departureLimit, initialUrlState.stopIds, stops.length, visibleDepartureCount]);

  useEffect(() => {
    if (!mapReady || !stopSourceRef.current) {
      return;
    }

    const data: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: stops.map((stop, index) => ({
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

    if (stops.length > 0 && mapRef.current) {
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
  }, [mapReady, stops]);

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
    if (!mapReady || stops.length === 0 || !rootRef.current || !mapShellRef.current || !mapRef.current) {
      setLeaderLines([]);
      return;
    }

    const updateLeaderLines = () => {
      if (leaderLineFrameRef.current !== null) {
        window.cancelAnimationFrame(leaderLineFrameRef.current);
      }

      leaderLineFrameRef.current = window.requestAnimationFrame(() => {
        leaderLineFrameRef.current = null;

        const rootRect = rootRef.current?.getBoundingClientRect();
        const mapRect = mapShellRef.current?.getBoundingClientRect();
        const map = mapRef.current;

        if (!rootRect || !mapRect || !map) {
          return;
        }

        setOverlaySize({
          width: Math.max(1, Math.ceil(rootRect.width)),
          height: Math.max(1, Math.ceil(rootRect.height)),
        });

        const nextLines: LeaderRibbon[] = stops.flatMap((stop, index) => {
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
  }, [mapReady, stops]);

  return (
    <div ref={rootRef} className="relative h-[100dvh] overflow-hidden bg-[#050816] text-slate-50">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_75%_15%,rgba(14,165,233,0.16),transparent_28%),linear-gradient(120deg,#020617,#0f172a_45%,#08111f)]" />

      <div className="relative z-10 grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 p-3 md:grid-cols-[minmax(24rem,36vw)_minmax(0,1fr)] md:grid-rows-1">
        <section className="relative min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/72 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md">
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent md:block" />
          <div className="flex h-full min-h-0 flex-col p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.28em] text-emerald-200">
                <MapPinned className="h-3.5 w-3.5" />
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
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

            {initialUrlState.stopIds.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[1.6rem] border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm leading-6 text-slate-300">
                Add stop IDs in the URL, for example <code className="font-mono">?stops=HSL:1040129</code>.
              </div>
            ) : (
              <div
                className="grid min-h-0 flex-1 gap-3"
                style={stopBoardLayout}
              >
                {activeStops.map((stop, index) => (
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
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.36" />
                <stop offset="18%" stopColor={line.color} stopOpacity="0.34" />
                <stop offset="58%" stopColor={line.color} stopOpacity="0.18" />
                <stop offset="100%" stopColor="#020617" stopOpacity="0.18" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.26" />
                <stop offset="28%" stopColor={line.color} stopOpacity="0.46" />
                <stop offset="72%" stopColor={line.color} stopOpacity="0.32" />
                <stop offset="100%" stopColor={line.color} stopOpacity="0.22" />
              </linearGradient>
            </defs>
            <polygon
              points={line.polygon}
              fill="none"
              stroke={withAlpha(line.color, 0.18)}
              strokeWidth="2"
              strokeLinejoin="round"
              opacity="0.58"
            />
            <polygon
              data-testid="leader-ribbon"
              points={line.polygon}
              fill={`url(#${line.svgId}-deck)`}
              stroke={`url(#${line.svgId}-rim)`}
              strokeWidth="0.9"
              strokeLinejoin="round"
              opacity="0.86"
            />
            <polygon
              points={line.polygon}
              fill="none"
              stroke={withAlpha("#ffffff", 0.12)}
              strokeWidth="0.4"
              strokeLinejoin="round"
              opacity="0.58"
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

      <button
        type="button"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        onClick={() => setMenuOpen((current) => !current)}
        className="absolute right-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-950/35 text-slate-200 opacity-25 backdrop-blur-sm transition hover:opacity-80 focus:opacity-90"
      >
        {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {menuOpen ? (
        <div className="absolute right-4 top-16 z-30 w-[min(24rem,calc(100vw-2rem))] rounded-[1.6rem] border border-white/10 bg-slate-950/92 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur-xl">
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
              value={initialUrlState.stopIds.length > 0 ? initialUrlState.stopIds.join(", ") : "None"}
            />
            <InfoRow
              label="URL"
              value={serializeUrlState({ viewport, stopIds: initialUrlState.stopIds })}
              multiline
            />
          </div>

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

function isDepartureExpired(departure: Departure, now: Date) {
  return getDepartureTimestamp(departure) + DEPARTURE_EXPIRY_GRACE_MS < now.getTime();
}

function getDepartureTimestamp(departure: Departure) {
  return (departure.serviceDay + departure.realtimeDeparture) * 1000;
}

function getMaxDepartureCount(stops: StopWithDepartures[]) {
  return stops.reduce((max, stop) => Math.max(max, stop.departures.length), 0);
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
