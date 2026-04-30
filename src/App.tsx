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
const STOP_CARD_CLASSES = [
  "border-emerald-300/35 bg-emerald-400/8",
  "border-sky-300/35 bg-sky-400/8",
  "border-amber-300/35 bg-amber-400/8",
  "border-pink-300/35 bg-pink-400/8",
] as const;
const STOP_BADGE_CLASSES = [
  "bg-emerald-300 text-slate-950",
  "bg-sky-300 text-slate-950",
  "bg-amber-300 text-slate-950",
  "bg-pink-300 text-slate-950",
] as const;

type LeaderLine = {
  id: string;
  color: string;
  path: string;
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
  const [leaderLines, setLeaderLines] = useState<LeaderLine[]>([]);
  const [overlaySize, setOverlaySize] = useState({ width: 1, height: 1 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleSourceRef = useRef<GeoJSONSource | null>(null);
  const stopSourceRef = useRef<GeoJSONSource | null>(null);
  const vehicleFrameRef = useRef<number | null>(null);
  const leaderLineFrameRef = useRef<number | null>(null);
  const vehiclesRef = useRef<Map<string, VehicleSnapshot>>(new Map());
  const stopCardRefs = useRef(new Map<string, HTMLElement>());

  const { vehicles, status: vehicleStreamStatus } = useVehicleStream();
  const digitransitApiKeyConfigured = Boolean(import.meta.env.VITE_DIGITRANSIT_API_KEY);
  const departureLimit = getDepartureLimit(initialUrlState.stopIds.length);
  const isStackedLayout = overlaySize.width < 768;
  const stopBoardLayout = getStopBoardLayout(stops.length, isStackedLayout);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

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
          center: [viewport.lon, viewport.lat],
          zoom: viewport.zoom,
          attributionControl: false,
        });

        map.addControl(
          new maplibregl.AttributionControl({
            compact: true,
            customAttribution: "Realtime data: HSL Digitransit",
          }),
          "bottom-right",
        );

        map.on("load", () => {
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
            id: "stop-order-labels",
            type: "symbol",
            source: stopSourceId,
            layout: {
              "text-field": ["to-string", ["get", "order"]],
              "text-font": ["Open Sans Bold"],
              "text-size": 11,
            },
            paint: {
              "text-color": "#020617",
            },
          });

          map.addLayer({
            id: "stop-labels",
            type: "symbol",
            source: stopSourceId,
            layout: {
              "text-field": [
                "concat",
                ["to-string", ["get", "order"]],
                " ",
                ["coalesce", ["get", "code"], ["get", "name"]],
              ],
              "text-font": ["Open Sans Semibold"],
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
              "text-font": ["Open Sans Bold"],
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
        });

        map.on("moveend", () => {
          const center = map.getCenter();
          const nextViewport = {
            lat: round(center.lat, 5),
            lon: round(center.lng, 5),
            zoom: round(map.getZoom(), 2),
          };

          setViewport(nextViewport);

          const nextUrl = serializeUrlState({
            viewport: nextViewport,
            stopIds: initialUrlState.stopIds,
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
  }, [initialUrlState.stopIds, viewport.lat, viewport.lon, viewport.zoom]);

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

        const nextLines: LeaderLine[] = stops.flatMap((stop, index) => {
          const card = stopCardRefs.current.get(stop.gtfsId);
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

          let path = "";
          let edgeX = 0;
          let edgeY = 0;
          let x2 = 0;
          let y2 = 0;

          if (mapIsBelow) {
            const x1 = clamp(cardLeft + cardRect.width * 0.5, cardLeft + 16, cardRight - 16);
            const y1 = cardBottom - 2;
            edgeX = clamp(mapLeft + projected.x, mapLeft + 16, mapLeft + mapWidth - 16);
            edgeY = mapTop + 8;
            x2 = edgeX;
            y2 = clamp(mapTop + projected.y, mapTop + 28, mapTop + mapHeight - 20);
            const bendY = y1 + Math.max(28, (edgeY - y1) * 0.45);
            path = `M ${x1} ${y1} L ${x1} ${bendY} L ${edgeX} ${edgeY} L ${x2} ${y2}`;
          } else if (mapIsToRight) {
            const x1 = cardRight - 2;
            const y1 = cardTop + cardRect.height * 0.5;
            x2 = clamp(mapLeft + projected.x, mapLeft + 28, mapLeft + mapWidth - 20);
            y2 = clamp(mapTop + projected.y, mapTop + 8, mapTop + mapHeight - 8);
            const bendX = x1 + 32;
            edgeX = mapLeft + 8;
            edgeY = interpolateLineYAtX(bendX, y1, x2, y2, edgeX);
            path = `M ${x1} ${y1} L ${bendX} ${y1} L ${x2} ${y2}`;
          } else {
            const x1 = cardRight - 2;
            const y1 = cardTop + cardRect.height * 0.5;
            x2 = clamp(mapLeft + projected.x, mapLeft + 28, mapLeft + mapWidth - 20);
            y2 = clamp(mapTop + projected.y, mapTop + 8, mapTop + mapHeight - 8);
            const bendX = x1 + 32;
            edgeX = mapLeft + 8;
            edgeY = interpolateLineYAtX(bendX, y1, x2, y2, edgeX);
            path = `M ${x1} ${y1} L ${bendX} ${y1} L ${x2} ${y2}`;
          }

          return [
            {
              id: stop.gtfsId,
              color: STOP_MARKER_COLORS[index] ?? "#ffffff",
              path,
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
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.28em] text-emerald-200">
                  <MapPinned className="h-3.5 w-3.5" />
                  Reitti
                </div>
                <h1 className="mt-2 text-[clamp(1.35rem,2vw,2rem)] font-semibold tracking-tight text-white">
                  Departures and map in one screen
                </h1>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                {formatVehicleStreamStatus(vehicleStreamStatus)}
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
                    key={stop.gtfsId}
                    ref={(element) => {
                      if (element) {
                        stopCardRefs.current.set(stop.gtfsId, element);
                      } else {
                        stopCardRefs.current.delete(stop.gtfsId);
                      }
                    }}
                    className={cn(
                      "relative min-h-0 overflow-hidden rounded-[1.65rem] border p-4",
                      STOP_CARD_CLASSES[index] ?? "border-white/10 bg-white/5",
                    )}
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-lg",
                          STOP_BADGE_CLASSES[index] ?? "bg-white text-slate-950",
                        )}
                      >
                        {index + 1}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-300">
                              {stop.code} {stop.vehicleMode ? `· ${stop.vehicleMode}` : ""}
                            </div>
                            <div className="mt-1 truncate text-[clamp(1rem,1.35vw,1.35rem)] font-semibold text-white">
                              {stop.name}
                            </div>
                          </div>
                          <span className="rounded-full bg-black/20 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-100">
                            {stop.departures.length}
                          </span>
                        </div>
                        {stop.desc ? (
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">
                            {stop.desc}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {stop.departures.map((departure) => (
                        <div
                          key={`${stop.gtfsId}-${departure.serviceDay}-${departure.realtimeDeparture}-${departure.headsign}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <ModeIcon mode={departure.routeMode} />
                              <span className="text-sm font-semibold text-white">
                                {departure.routeShortName ?? departure.routeMode}
                              </span>
                            </div>
                            <div className="mt-1 truncate text-sm text-slate-200">{departure.headsign}</div>
                          </div>

                          <div className="text-right">
                            <div className="text-sm font-semibold text-white">
                              {formatDepartureTime(departure.serviceDay, departure.realtimeDeparture)}
                            </div>
                            <div className="text-xs text-slate-300">
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

          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="rounded-full border border-white/10 bg-slate-950/55 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-slate-200 backdrop-blur-md">
              {stops.length > 0 ? `${stops.length} stop view` : "Preparing stop view"}
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
            <path
              d={line.path}
              fill="none"
              stroke={line.color}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
            <circle cx={line.edgeX} cy={line.edgeY} r="3.5" fill={line.color} opacity="0.95" />
            <circle cx={line.dotX} cy={line.dotY} r="4" fill={line.color} opacity="0.95" />
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

function ModeIcon({ mode }: { mode: string }) {
  if (mode === "TRAM") {
    return <TramFront className="h-4 w-4 text-blue-300" />;
  }

  if (mode === "RAIL" || mode === "SUBWAY") {
    return <TrainFront className="h-4 w-4 text-violet-300" />;
  }

  return <Bus className="h-4 w-4 text-emerald-300" />;
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

function interpolateLineYAtX(x1: number, y1: number, x2: number, y2: number, targetX: number) {
  if (Math.abs(x2 - x1) < 0.001) {
    return y2;
  }

  const progress = clamp((targetX - x1) / (x2 - x1), 0, 1);
  return lerp(y1, y2, progress);
}
