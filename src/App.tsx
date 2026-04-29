import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import {
  AlertTriangle,
  Bus,
  LoaderCircle,
  MapPinned,
  TrainFront,
  TramFront,
} from "lucide-react";
import { fetchStopsWithDepartures, type StopWithDepartures } from "./api/digitransit";
import { loadHslStyle } from "./lib/hslStyle";
import {
  MAX_STOP_COUNT,
  parseUrlState,
  serializeUrlState,
  type ViewportState,
} from "./lib/urlState";
import { cn } from "./lib/cn";
import { formatDepartureTime, formatRelativeMinutes } from "./lib/time";
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
  "border-emerald-300/35 bg-emerald-400/10",
  "border-sky-300/35 bg-sky-400/10",
  "border-amber-300/35 bg-amber-400/10",
  "border-pink-300/35 bg-pink-400/10",
] as const;
const STOP_BADGE_CLASSES = [
  "bg-emerald-300 text-slate-950",
  "bg-sky-300 text-slate-950",
  "bg-amber-300 text-slate-950",
  "bg-pink-300 text-slate-950",
] as const;

export default function App() {
  const initialUrlState = useMemo(() => parseUrlState(window.location.search), []);
  const [viewport, setViewport] = useState<ViewportState>(initialUrlState.viewport);
  const [stops, setStops] = useState<StopWithDepartures[]>([]);
  const [stopsLoading, setStopsLoading] = useState(false);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [styleLoading, setStyleLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleSourceRef = useRef<GeoJSONSource | null>(null);
  const stopSourceRef = useRef<GeoJSONSource | null>(null);
  const vehicleFrameRef = useRef<number | null>(null);
  const vehiclesRef = useRef<Map<string, VehicleSnapshot>>(new Map());

  const { vehicles, status: vehicleStreamStatus } = useVehicleStream();

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

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
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

          map.on("mouseenter", "stop-circles", () => {
            map.getCanvas().style.cursor = "pointer";
          });

          map.on("mouseleave", "stop-circles", () => {
            map.getCanvas().style.cursor = "";
          });

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
        setStyleError(
          error instanceof Error ? error.message : "Map style could not be loaded.",
        );
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
      vehicleSourceRef.current = null;
      stopSourceRef.current = null;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [initialUrlState.stopIds]);

  useEffect(() => {
    let cancelled = false;

    if (initialUrlState.stopIds.length === 0) {
      setStops([]);
      return;
    }

    setStopsLoading(true);
    setStopsError(null);

    fetchStopsWithDepartures(initialUrlState.stopIds)
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
  }, [initialUrlState.stopIds]);

  useEffect(() => {
    if (!mapReady || !stopSourceRef.current) {
      return;
    }

    const data: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: stops.map((stop) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [stop.lon, stop.lat],
        },
        properties: {
          gtfsId: stop.gtfsId,
          code: stop.code,
          name: stop.name,
          order: stops.findIndex((candidate) => candidate.gtfsId === stop.gtfsId) + 1,
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
        padding: { top: 80, right: 80, bottom: 80, left: 80 },
        maxZoom: 15.8,
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

  const digitransitApiKeyConfigured = Boolean(import.meta.env.VITE_DIGITRANSIT_API_KEY);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="grid min-h-screen grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top,#164e63,transparent_45%),linear-gradient(180deg,#020617,#0f172a)] xl:border-b-0 xl:border-r">
          <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(34,197,94,0.08),transparent_55%,rgba(59,130,246,0.14))]" />
          <div className="relative flex h-full flex-col p-5 sm:p-6">
            <div className="mb-6">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.28em] text-emerald-200">
                <MapPinned className="h-3.5 w-3.5" />
                Reitti
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white">Helsinki transit in one URL</h1>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-300">
                Vector map, realtime vehicles, and stop departures sourced from Digitransit.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <InfoCard label="Viewport" value={`${viewport.lat.toFixed(4)}, ${viewport.lon.toFixed(4)}`} />
              <InfoCard label="Zoom" value={viewport.zoom.toFixed(2)} />
              <InfoCard label="Tracked vehicles" value={String(vehicles.size)} />
              <InfoCard label="Realtime" value={formatVehicleStreamStatus(vehicleStreamStatus)} />
            </div>

            {!digitransitApiKeyConfigured && (
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
            )}

            {styleError && (
              <Notice className="mt-4 border-rose-300/30 bg-rose-500/10 text-rose-50">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Map style failed to load.</p>
                  <p className="text-rose-100/80">{styleError}</p>
                </div>
              </Notice>
            )}

            {vehicleStreamStatus === "error" && (
              <Notice className="mt-4 border-amber-300/30 bg-amber-400/10 text-amber-50">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Realtime feed unavailable in this browser session.</p>
                  <p className="text-amber-100/80">
                    The map and stop departures can still load. HSL MQTT over WebSocket may require a different broker setup than the public TLS endpoint.
                  </p>
                </div>
              </Notice>
            )}

            <section className="mt-6 flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Stops</h2>
                {stopsLoading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-300" />}
              </div>

              <p className="mb-4 text-xs uppercase tracking-[0.16em] text-slate-400">
                Showing up to {MAX_STOP_COUNT} linked stop boards at once.
              </p>

              {stopsError ? (
                <div className="rounded-3xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-rose-100">
                  {stopsError}
                </div>
              ) : null}

              {initialUrlState.stopIds.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-white/15 bg-white/5 p-5 text-sm leading-6 text-slate-300">
                  Add stop IDs in the URL, for example <code className="font-mono">?stops=HSL:1040129</code>.
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="space-y-4">
                    {stops.map((stop, index) => (
                      <section
                        key={stop.gtfsId}
                        className={cn(
                          "rounded-[28px] border p-4",
                          STOP_CARD_CLASSES[index] ?? "border-white/10 bg-white/5",
                        )}
                      >
                        <div className="mb-4 flex items-start gap-3 border-b border-white/10 pb-4">
                          <div
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                              STOP_BADGE_CLASSES[index] ?? "bg-white text-slate-950",
                            )}
                          >
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.22em] text-slate-300">
                                  {stop.code} {stop.vehicleMode ? `· ${stop.vehicleMode}` : ""}
                                </div>
                                <div className="mt-1 text-xl font-semibold text-white">{stop.name}</div>
                              </div>
                              <span className="rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-100">
                                {stop.departures.length} departures
                              </span>
                            </div>
                            {stop.desc ? (
                              <div className="mt-1 text-sm text-slate-300">{stop.desc}</div>
                            ) : null}
                          </div>
                        </div>

                        <div className="space-y-2">
                          {stop.departures.map((departure) => (
                            <div
                              key={`${stop.gtfsId}-${departure.serviceDay}-${departure.realtimeDeparture}-${departure.headsign}`}
                              className="rounded-2xl border border-white/8 bg-white/5 px-3 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <ModeIcon mode={departure.routeMode} />
                                    <span className="text-sm font-semibold text-white">
                                      {departure.routeShortName ?? departure.routeMode}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-sm text-slate-200">{departure.headsign}</div>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-semibold text-white">
                                    {formatDepartureTime(
                                      departure.serviceDay,
                                      departure.realtimeDeparture,
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-300">
                                    {formatRelativeMinutes(
                                      departure.serviceDay,
                                      departure.realtimeDeparture,
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </aside>

        <main className="relative min-h-[50vh] xl:min-h-screen">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute inset-x-0 top-0 p-4">
            <div className="mx-auto max-w-3xl rounded-full border border-white/15 bg-slate-950/55 px-4 py-2 text-center text-xs font-medium tracking-[0.18em] text-slate-100 backdrop-blur-md">
              {serializeUrlState({ viewport, stopIds: initialUrlState.stopIds })}
            </div>
          </div>

          {(styleLoading || !mapReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/45 backdrop-blur-sm">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-950/80 px-5 py-3 text-sm text-slate-100 shadow-2xl">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Preparing the map
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
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
