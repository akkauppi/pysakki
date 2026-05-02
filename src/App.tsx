import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  useVehicleStream,
  type VehicleSnapshot,
  type VehicleStreamStatus,
} from "./lib/useVehicleStream";

const stopSourceId = "selected-stops";
const vehicleSourceId = "vehicles";
const VEHICLE_TRANSITION_MS = 900;
const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;
const HSL_LABEL_FONT = ["Gotham Rounded Medium"];
type LeaderRibbon = {
  id: string;
  color: string;
  polygon: string;
  spinePath: string;
  edgeX: number;
  edgeY: number;
  dotX: number;
  dotY: number;
};

export default function App() {
  const initialUrlState = useMemo(() => parseUrlState(window.location.search), []);
  const [viewport, setViewport] = useState<ViewportState>(initialUrlState.viewport);
  const [stops, setStops] = useState<StopWithDepartures[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleLoading, setStyleLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
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

  const { vehicles, status: vehicleStreamStatus } = useVehicleStream();
  const digitransitApiKeyConfigured = Boolean(import.meta.env.VITE_DIGITRANSIT_API_KEY);
  const departureLimit = getDepartureLimit(initialUrlState.stopIds.length);
  const isStackedLayout = overlaySize.width < 768;
  const stopBoardLayout = getStopBoardLayout(stops.length, isStackedLayout);
  const visibleDepartureCount = getVisibleDepartureCount(stops.length, isStackedLayout, overlaySize);
  const compactSchedule = visibleDepartureCount <= 2;
  const ultraCompactSchedule = visibleDepartureCount <= 1 && stops.length >= 3;

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

        map.on("moveend", () => {
          const center = map.getCenter();
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

          const nextUrl = serializeUrlState({
            viewport: nextViewport,
            stopIds: stopIdsRef.current,
          });

          window.history.replaceState({}, "", nextUrl);
        });

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

    if (initialUrlState.stopIds.length === 0) {
      setStops([]);
      return;
    }

    setStopsLoading(true);
    setStopsError(null);

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
        if (!cancelled) {
          setStopsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [departureLimit, initialUrlState.stopIds]);

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
          const routeToMapBottom = mapIsBelow && index >= 2;
          const ribbonWidths = getLeaderRibbonWidths(stops.length, mapIsBelow, rootRect.width);

          let spinePoints: Array<{ x: number; y: number }> = [];
          let edgeX = 0;
          let edgeY = 0;
          let x2 = 0;
          let y2 = 0;

          if (routeToMapBottom) {
            const cardCenterX = cardLeft + cardRect.width * 0.5;
            const x1 = clamp(cardCenterX, cardLeft + 16, cardRight - 16);
            const y1 = cardBottom - 2;
            const routeOnLeft = cardCenterX < mapLeft + mapWidth * 0.5;
            const sideX = routeOnLeft ? mapLeft + 18 : mapLeft + mapWidth - 18;
            const topY = Math.max(y1 + 18, mapTop - 18);
            edgeX = sideX;
            edgeY = mapTop + mapHeight - 10;
            x2 = clamp(mapLeft + projected.x, mapLeft + 28, mapLeft + mapWidth - 28);
            y2 = clamp(mapTop + projected.y, mapTop + 28, mapTop + mapHeight - 32);
            spinePoints = [
              { x: x1, y: y1 },
              { x: x1, y: topY },
              { x: sideX, y: topY },
              { x: edgeX, y: edgeY },
              { x: x2, y: y2 },
            ];
          } else if (mapIsBelow) {
            const x1 = clamp(cardLeft + cardRect.width * 0.5, cardLeft + 16, cardRight - 16);
            const y1 = cardBottom - 2;
            edgeX = clamp(mapLeft + projected.x, mapLeft + 16, mapLeft + mapWidth - 16);
            edgeY = mapTop + 8;
            x2 = edgeX;
            y2 = clamp(mapTop + projected.y, mapTop + 28, mapTop + mapHeight - 20);
            const bendY = y1 + Math.max(28, (edgeY - y1) * 0.45);
            spinePoints = [
              { x: x1, y: y1 },
              { x: x1, y: bendY },
              { x: edgeX, y: edgeY },
              { x: x2, y: y2 },
            ];
          } else if (mapIsToRight) {
            const x1 = cardRight - 2;
            const y1 = cardTop + cardRect.height * 0.5;
            x2 = clamp(mapLeft + projected.x, mapLeft + 28, mapLeft + mapWidth - 20);
            y2 = clamp(mapTop + projected.y, mapTop + 8, mapTop + mapHeight - 8);
            const bendX = x1 + 32;
            edgeX = mapLeft + 8;
            edgeY = interpolateLineYAtX(bendX, y1, x2, y2, edgeX);
            spinePoints = [
              { x: x1, y: y1 },
              { x: bendX, y: y1 },
              { x: x2, y: y2 },
            ];
          } else {
            const x1 = cardRight - 2;
            const y1 = cardTop + cardRect.height * 0.5;
            x2 = clamp(mapLeft + projected.x, mapLeft + 28, mapLeft + mapWidth - 20);
            y2 = clamp(mapTop + projected.y, mapTop + 8, mapTop + mapHeight - 8);
            const bendX = x1 + 32;
            edgeX = mapLeft + 8;
            edgeY = interpolateLineYAtX(bendX, y1, x2, y2, edgeX);
            spinePoints = [
              { x: x1, y: y1 },
              { x: bendX, y: y1 },
              { x: x2, y: y2 },
            ];
          }

          const polygon = buildRibbonPolygon(
            spinePoints,
            ribbonWidths.start,
            ribbonWidths.end,
          );
          const spinePath = toSvgPath(spinePoints);

          return [
            {
              id: leaderId,
              color: STOP_MARKER_COLORS[index] ?? "#ffffff",
              polygon,
              spinePath,
              edgeX,
              edgeY,
              dotX: x2,
              dotY: y2,
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
                {stops.map((stop, index) => (
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
                      "relative min-h-0 overflow-hidden rounded-[1.65rem] border backdrop-blur-md",
                      ultraCompactSchedule ? "p-1.5 sm:p-2" : compactSchedule ? "p-2.5 sm:p-3" : "p-4",
                    )}
                    style={getStopCardStyle(STOP_MARKER_COLORS[index] ?? "#ffffff")}
                  >
                    <div className={cn("flex items-start gap-3", ultraCompactSchedule ? "mb-1" : compactSchedule ? "mb-2" : "mb-3")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className={cn("uppercase text-slate-300", ultraCompactSchedule ? "text-[8px] tracking-[0.1em]" : compactSchedule ? "text-[9px] tracking-[0.16em]" : "text-[10px] tracking-[0.22em]")}>
                              {stop.code} {stop.vehicleMode ? `· ${stop.vehicleMode}` : ""}
                            </div>
                            <div className={cn("truncate font-semibold text-white", ultraCompactSchedule ? "mt-0.5 text-[clamp(0.72rem,2.8vw,0.9rem)] leading-none" : compactSchedule ? "mt-1 text-[clamp(0.86rem,2.6vw,1.05rem)] leading-tight" : "mt-1 text-[clamp(1rem,1.35vw,1.35rem)]")}>
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

                    <div className={cn("grid", ultraCompactSchedule ? "gap-1" : compactSchedule ? "gap-1.5" : "gap-2")}>
                      {stop.departures.slice(0, visibleDepartureCount).map((departure) => (
                        <div
                          key={`${stop.gtfsId}-${departure.serviceDay}-${departure.realtimeDeparture}-${departure.headsign}`}
                          data-testid="departure-row"
                          className={cn(
                            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-2xl border border-white/8",
                            ultraCompactSchedule && "grid-cols-[minmax(0,1fr)_auto] gap-1.5 rounded-xl px-1.5 py-1",
                            compactSchedule && !ultraCompactSchedule ? "gap-2 px-2 py-2" : null,
                            !compactSchedule ? "gap-3 px-3 py-3" : null,
                          )}
                          style={getStopRowStyle(STOP_MARKER_COLORS[index] ?? "#ffffff")}
                        >
                          <div className={cn("items-center justify-center rounded-2xl bg-black/20", ultraCompactSchedule ? "hidden" : compactSchedule ? "flex h-8 w-8" : "flex h-12 w-12")}>
                            <ModeIcon mode={departure.routeMode} className={compactSchedule ? "h-5 w-5" : "h-7 w-7"} />
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-end gap-2">
                              <span className={cn("font-semibold leading-none text-white", ultraCompactSchedule ? "text-[clamp(0.88rem,3.4vw,1.05rem)]" : compactSchedule ? "text-[clamp(1rem,3.8vw,1.35rem)]" : "text-[clamp(1.35rem,2vw,2rem)]")}>
                                {departure.routeShortName ?? departure.routeMode}
                              </span>
                              <span className={cn("truncate pb-0.5 text-slate-200", ultraCompactSchedule ? "text-[10px]" : compactSchedule ? "text-xs" : "text-sm")}>{departure.headsign}</span>
                            </div>
                            <div className={cn("mt-1 uppercase text-slate-300", ultraCompactSchedule ? "hidden" : compactSchedule ? "text-[10px] tracking-[0.12em]" : "text-xs tracking-[0.18em]")}>
                              {formatDepartureTime(departure.serviceDay, departure.realtimeDeparture)}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className={cn("font-semibold leading-none text-white tabular-nums", ultraCompactSchedule ? "text-[clamp(0.9rem,3.8vw,1.08rem)]" : compactSchedule ? "text-[clamp(1.05rem,4vw,1.45rem)]" : "text-[clamp(1.45rem,2.4vw,2.35rem)]")}>
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

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
            <div className="pointer-events-auto max-w-[min(92%,38rem)] rounded-2xl border border-white/10 bg-slate-950/68 px-3 py-2 text-center text-[10px] leading-4 text-slate-300 backdrop-blur-md">
              Realtime data: HSL Digitransit | Digitransit data is licensed under CC BY 4.0. |
              {" "}
              © OpenMapTiles © OpenStreetMap contributors
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
          <g key={line.id}>
            <polygon
              points={line.polygon}
              fill={line.color}
              stroke={withAlpha(line.color, 0.38)}
              strokeWidth="1.5"
              strokeLinejoin="round"
              opacity="0.26"
            />
            <path
              d={line.spinePath}
              fill="none"
              stroke={line.color}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.4"
            />
            <circle cx={line.edgeX} cy={line.edgeY} r="3.5" fill={line.color} opacity="0.8" />
            <circle cx={line.dotX} cy={line.dotY} r="4" fill={line.color} opacity="0.9" />
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

function formatClockTime(value: Date) {
  return new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function getDepartureLimit(stopCount: number) {
  if (stopCount >= 4) {
    return 3;
  }

  if (stopCount === 3) {
    return 4;
  }

  if (stopCount === 2) {
    return 5;
  }

  return 6;
}

function getVisibleDepartureCount(
  stopCount: number,
  isStackedLayout: boolean,
  screenSize: { width: number; height: number },
) {
  const height = screenSize.height;

  if (stopCount >= 4) {
    return height < 560 ? 0 : height >= 900 && !isStackedLayout ? 2 : 1;
  }

  if (stopCount === 3) {
    if (height < 560) {
      return 0;
    }

    if (isStackedLayout || height < 760) {
      return 1;
    }

    return height >= 900 && !isStackedLayout ? 3 : 2;
  }

  if (stopCount === 2) {
    return height < 620 ? 2 : 4;
  }

  return height < 520 ? 3 : 6;
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

function getLeaderRibbonWidths(stopCount: number, isStackedLayout: boolean, screenWidth: number) {
  const densityScale = stopCount >= 3 ? 0.72 : 1;
  const screenScale = screenWidth < 520 ? 0.56 : screenWidth < 768 ? 0.68 : 1;
  const layoutScale = isStackedLayout ? 0.82 : 1;
  const scale = densityScale * screenScale * layoutScale;

  return {
    start: Math.max(34, Math.round(102 * scale)),
    end: Math.max(16, Math.round(30 * scale)),
  };
}

function getStopCardStyle(color: string) {
  return {
    borderColor: withAlpha(color, 0.34),
    background: `linear-gradient(145deg, ${withAlpha(color, 0.2)}, ${withAlpha(color, 0.08)} 46%, rgba(2, 6, 23, 0.52))`,
    boxShadow: `inset 0 1px 0 ${withAlpha(color, 0.22)}, 0 18px 48px rgba(2, 6, 23, 0.24)`,
  };
}

function getStopRowStyle(color: string) {
  return {
    borderColor: withAlpha(color, 0.2),
    background: `linear-gradient(135deg, ${withAlpha(color, 0.14)}, rgba(2, 6, 23, 0.3) 62%)`,
  };
}

function interpolateLineYAtX(x1: number, y1: number, x2: number, y2: number, targetX: number) {
  if (Math.abs(x2 - x1) < 0.001) {
    return y2;
  }

  const progress = clamp((targetX - x1) / (x2 - x1), 0, 1);
  return lerp(y1, y2, progress);
}

function buildRibbonPolygon(
  points: Array<{ x: number; y: number }>,
  startWidth: number,
  endWidth: number,
) {
  if (points.length < 2) {
    return "";
  }

  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = normalize({
      x: next.x - prev.x,
      y: next.y - prev.y,
    });
    const normal = {
      x: -tangent.y,
      y: tangent.x,
    };
    const progress = points.length === 1 ? 1 : index / (points.length - 1);
    const width = lerp(startWidth, endWidth, progress);

    left.push({
      x: point.x + normal.x * (width / 2),
      y: point.y + normal.y * (width / 2),
    });
    right.push({
      x: point.x - normal.x * (width / 2),
      y: point.y - normal.y * (width / 2),
    });
  }

  return [...left, ...right.reverse()].map((point) => `${point.x},${point.y}`).join(" ");
}

function toSvgPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }

  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`;
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
