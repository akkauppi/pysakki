import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MapMouseEvent } from "maplibre-gl";
import {
  AlertTriangle,
  Check,
  Copy,
  Crosshair,
  LocateFixed,
  LoaderCircle,
  MapPinned,
  Menu,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchNearbyStops,
  fetchStopsWithDepartures,
  type NearbyStopCandidate,
  type StopWithDepartures,
} from "./api/digitransit";
import { LeaderOverlay } from "./components/LeaderOverlay";
import { StopBoard } from "./components/StopBoard";
import { cn } from "./lib/cn";
import {
  filterStopsWithActiveDepartures,
  getDepartureLimit,
  getMaxDepartureCount,
  mergeArrangedStopIds,
  orderStopsByIds,
} from "./lib/departures";
import { formatClockTime } from "./lib/displayFormat";
import {
  MAX_STOP_COUNT,
  serializeUrlState,
  type ViewportState,
} from "./lib/urlState";
import {
  getAppGridStyle,
  getScheduleFit,
  getScheduleScaleStyle,
  getStopBoardLayout,
  type ScheduleRowVariant,
} from "./lib/scheduleLayout";
import { useLeaderOverlay } from "./hooks/useLeaderOverlay";
import { useTransitMap } from "./hooks/useTransitMap";
import {
  clearUserConfig,
  resolveInitialUserConfig,
  saveUserConfig,
} from "./lib/userConfig";
import {
  getVehicleMqttTopics,
  useVehicleStream,
  type VehicleBounds,
  type VehicleStreamStatus,
} from "./lib/useVehicleStream";

const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;
const STOP_REFRESH_INTERVAL_MS = 60_000;
const STOP_REFRESH_MIN_INTERVAL_MS = 15_000;
const GEOLOCATION_TIMEOUT_MS = 10_000;
const LOCATION_ZOOM = 15.8;
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
  const [overlaySize, setOverlaySize] = useState({ width: 1, height: 1 });
  const [now, setNow] = useState(() => new Date());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const initialViewportRef = useRef(initialUserConfig.viewport);
  const stopIdsRef = useRef(initialUserConfig.stopIds);
  const stopsRef = useRef<StopWithDepartures[]>([]);
  const editBaselineRef = useRef<EditBaseline>({
    stopIds: initialUserConfig.stopIds,
    viewport: initialUserConfig.viewport,
  });
  const stopCardRefs = useRef(new Map<string, HTMLElement>());
  const lastStopRefreshAtRef = useRef(0);
  const previousScheduleRowVariantRef = useRef<ScheduleRowVariant>("compact");

  const vehicleMqttTopics = useMemo(
    () => getVehicleMqttTopics(vehicleBounds),
    [vehicleBounds],
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
  const hasDirectionHints = displayStops.some((stop) => stop.directionHint);
  const splitStackedSchedules =
    isStackedLayout &&
    overlaySize.height >= 600 &&
    overlaySize.height >= overlaySize.width &&
    !setupMode &&
    !editMode &&
    displayStops.length >= 3;
  const topDisplayStops = splitStackedSchedules ? displayStops.slice(0, 2) : displayStops;
  const bottomDisplayStops = splitStackedSchedules ? displayStops.slice(2) : [];
  const stopBoardLayout = getStopBoardLayout(displayStops.length, isStackedLayout);
  const topStopBoardLayout = getStopBoardLayout(topDisplayStops.length, isStackedLayout);
  const bottomStopBoardLayout = getStopBoardLayout(bottomDisplayStops.length, isStackedLayout);
  const maxActiveDepartureCount = getMaxDepartureCount(activeStops);
  const scheduleFit = getScheduleFit(
    displayStops.length,
    Math.min(departureLimit, maxActiveDepartureCount),
    isStackedLayout,
    overlaySize,
    previousScheduleRowVariantRef.current,
    hasDirectionHints,
    splitStackedSchedules,
  );
  previousScheduleRowVariantRef.current = scheduleFit.rowVariant;
  const visibleDepartureCount = scheduleFit.visibleCount;
  const compactSchedule = visibleDepartureCount <= 2;
  const showScheduledTime = scheduleFit.rowVariant === "full";
  const showModeIcon = scheduleFit.rowVariant !== "compact";
  const showHeadsign = scheduleFit.rowVariant !== "compact";
  const ultraCompactSchedule = scheduleFit.rowVariant === "compact";
  const denseScheduleHeader = scheduleFit.rowVariant !== "full" || displayStops.length >= 4;
  const emptySchedule = visibleDepartureCount === 0;
  const scheduleScaleStyle = getScheduleScaleStyle(scheduleFit, compactSchedule);
  const appGridStyle = getAppGridStyle({
    isStackedLayout,
    screenSize: overlaySize,
    splitStackedSchedules,
    stopCount: displayStops.length,
  });
  const shareUrl = getShareUrl(viewport, stopIds);
  const {
    mapContainerRef,
    mapRef,
    mapReady,
    styleError,
    styleLoading,
  } = useTransitMap({
    initialViewport: initialUserConfig.viewport,
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
  });
  const { leaderLines } = useLeaderOverlay({
    mapReady,
    displayStops,
    stopsLength: stops.length,
    rootRef,
    mapShellRef,
    mapRef,
    stopCardRefs,
    setArrangedStopIds,
    setOverlaySize,
    stopsRef,
    colors: STOP_MARKER_COLORS,
  });

  useEffect(() => {
    stopIdsRef.current = stopIds;
  }, [stopIds]);

  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  useEffect(() => {
    setArrangedStopIds((current) => mergeArrangedStopIds(current, stops));
  }, [stops]);

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
            setStopsError(error instanceof Error ? error.message : "Departure data request failed.");
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
          setStopsError(error instanceof Error ? error.message : "Departure data request failed.");
        }
      })

    return () => {
      cancelled = true;
    };
  }, [activeStops, departureLimit, stopIds, stops.length, visibleDepartureCount]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !editMode) {
      return;
    }

    const map = mapRef.current;
    const addStopFromMapClick = (event: MapMouseEvent) => {
      setEditStatus("Looking for nearby departures...");
      fetchNearbyStops({
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
            setEditStatus(candidates.length > 0 ? "Those nearby departures are already selected." : "No transit stop found at that point.");
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
  }, [editMode, mapReady, mapRef]);

  const beginEditMode = () => {
    editBaselineRef.current = {
      stopIds,
      viewport,
    };
    setSetupMode(false);
    setEditMode(true);
    setMenuOpen(false);
    setEditStatus("Pan the map, tap a transit stop area, or use nearby suggestions.");
    setShareStatus("idle");
  };

  const beginManualSetup = () => {
    editBaselineRef.current = {
      stopIds: [],
      viewport,
    };
    setSetupMode(false);
    setEditMode(true);
    setEditStatus("Pan the map and tap near transit stops to add them.");
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
  };

  const addNearbyStop = (candidate: NearbyStopCandidate) => {
    setStopIds((current) => addStopId(current, candidate.gtfsId));
    setEditStatus(`${formatStopLabel(candidate)} selected.`);
    setShareStatus("idle");
  };

  const removeSelectedStop = (stopId: string) => {
    setStopIds((current) => current.filter((currentStopId) => currentStopId !== stopId));
    setEditStatus("Removed.");
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

      <div
        className={cn(
          "relative grid h-full min-h-0 grid-cols-1 gap-2 p-2 md:grid-cols-[minmax(24rem,36vw)_minmax(0,1fr)] md:grid-rows-1 md:gap-3 md:p-3",
          splitStackedSchedules
            ? "grid-rows-[minmax(0,0.95fr)_minmax(0,0.85fr)_minmax(0,0.95fr)]"
            : "grid-rows-[minmax(0,1.65fr)_minmax(0,0.75fr)]",
        )}
        style={appGridStyle}
      >
        <section className="relative z-30 min-h-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/72 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md md:rounded-[2rem]">
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent md:block" />
          <div className="flex h-full min-h-0 flex-col p-2.5 sm:p-4 md:p-5">
            <div className="mb-2 flex items-center justify-between gap-3 sm:mb-3">
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

            {stopsLoading ? (
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                Loading departures
              </div>
            ) : null}

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
              <StopBoard
                stops={topDisplayStops}
                allDisplayStops={displayStops}
                layout={splitStackedSchedules ? topStopBoardLayout : stopBoardLayout}
                testId="stop-board"
                stopCardRefs={stopCardRefs}
                visibleDepartureCount={visibleDepartureCount}
                scheduleFit={scheduleFit}
                scheduleScaleStyle={scheduleScaleStyle}
                compactSchedule={compactSchedule}
                denseScheduleHeader={denseScheduleHeader}
                ultraCompactSchedule={ultraCompactSchedule}
                emptySchedule={emptySchedule}
                showModeIcon={showModeIcon}
                showHeadsign={showHeadsign}
                showScheduledTime={showScheduledTime}
              />
            )}
          </div>
        </section>

        <main
          data-testid="map-shell"
          ref={mapShellRef}
          className="relative z-10 min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/68 shadow-[0_24px_80px_rgba(2,6,23,0.5)]"
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

        {splitStackedSchedules ? (
          <section
            data-testid="bottom-stop-panel"
            className="relative z-30 min-h-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/72 p-2 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md sm:p-3 md:rounded-[2rem] md:p-4"
          >
            <StopBoard
              stops={bottomDisplayStops}
              allDisplayStops={displayStops}
              layout={bottomStopBoardLayout}
              testId="bottom-stop-board"
              stopCardRefs={stopCardRefs}
              visibleDepartureCount={visibleDepartureCount}
              scheduleFit={scheduleFit}
              scheduleScaleStyle={scheduleScaleStyle}
              compactSchedule={compactSchedule}
              denseScheduleHeader={denseScheduleHeader}
              ultraCompactSchedule={ultraCompactSchedule}
              emptySchedule={emptySchedule}
              showModeIcon={showModeIcon}
              showHeadsign={showHeadsign}
              showScheduledTime={showScheduledTime}
            />
          </section>
        ) : null}
      </div>

      <LeaderOverlay leaderLines={leaderLines} overlaySize={overlaySize} />

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
              label="Selection"
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
              Edit
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
        <div className="text-lg font-semibold text-white">Set up nearby departures</div>
        <div className="mt-2 max-w-[30rem] text-sm leading-6 text-slate-300">
          Use your location to select nearby departures, or choose from the map.
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
          Location was unavailable. You can still choose from the map.
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
      className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 overflow-hidden rounded-[1.6rem] border border-cyan-200/15 bg-white/[0.04] p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-sm text-slate-200 sm:gap-3 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-white">Edit departures</div>
          <div className="mt-0.5 text-xs leading-4 text-slate-400">Tap the map or add a nearby suggestion.</div>
        </div>
        <div className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
          {selectedStopIds.length}/{MAX_STOP_COUNT}
        </div>
      </div>

      <div className="grid min-h-0 content-start gap-2 overflow-auto pr-1 sm:gap-3">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-400">Selected</div>
          <div className="grid gap-2" data-testid="edit-selected-stops">
            {selectedStopIds.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-3 py-3 text-xs leading-5 text-slate-400">
                Nothing selected yet.
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
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-1.5 sm:grid-cols-2 sm:gap-2">
        <button
          type="button"
          onClick={onUseLocation}
          disabled={locating}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-2 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
        >
          {locating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          Location
        </button>
        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-2 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
        >
          {shareStatus === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {shareStatus === "copied" ? "Copied" : "Copy link"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-2 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="edit-reset-choices"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-amber-200/20 bg-amber-300/10 px-2 py-2 text-xs font-medium text-amber-50 transition hover:bg-amber-300/16"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
        <button
          type="button"
          data-testid="edit-save"
          onClick={onSave}
          disabled={selectedStopIds.length === 0}
          className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-2xl border border-cyan-200/25 bg-cyan-300/12 px-2 py-2 text-xs font-medium text-cyan-50 transition hover:bg-cyan-300/18 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
        >
          <Check className="h-4 w-4" />
          Done
        </button>
      </div>
    </div>
  );
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

function addStopId(stopIds: string[], stopId: string) {
  if (stopIds.includes(stopId) || stopIds.length >= MAX_STOP_COUNT) {
    return stopIds;
  }

  return [...stopIds, stopId].slice(0, MAX_STOP_COUNT);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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
