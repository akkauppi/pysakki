import { useEffect, useMemo, useRef, useState } from "react";
import type { MapMouseEvent } from "maplibre-gl";
import {
  AlertTriangle,
  LoaderCircle,
  MapPinned,
  Menu,
  X,
} from "lucide-react";
import {
  fetchNearbyStops,
  type NearbyStopCandidate,
} from "./api/digitransit";
import { LeaderOverlay } from "./components/LeaderOverlay";
import { StopBoard } from "./components/StopBoard";
import { Notice } from "./components/Notice";
import { FirstRunPanel } from "./components/FirstRunPanel";
import { EditStopsPanel } from "./components/EditStopsPanel";
import { AppMenu } from "./components/AppMenu";
import { cn } from "./lib/cn";
import {
  filterStopsWithActiveDepartures,
  getDepartureLimit,
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
  getStackedPhoneDepartureRows,
  getStopBoardLayout,
} from "./lib/scheduleLayout";
import { useLeaderOverlay } from "./hooks/useLeaderOverlay";
import { useTransitMap } from "./hooks/useTransitMap";
import { useStopDepartures } from "./hooks/useStopDepartures";
import { useAppState } from "./hooks/useAppState";
import {
  getVehicleMqttTopics,
  useVehicleStream,
  type VehicleBounds,
} from "./lib/useVehicleStream";

const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;

export default function App() {
  const {
    viewport,
    setViewport,
    stopIds,
    setStopIds,
    stopIdsRef,
    setupMode,
    editMode,
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
    initialViewport,
  } = useAppState();

  const [vehicleBounds, setVehicleBounds] = useState<VehicleBounds>(() =>
    getFallbackVehicleBounds(initialViewport),
  );
  const [arrangedStopIds, setArrangedStopIds] = useState<string[]>(stopIds);
  const [overlaySize, setOverlaySize] = useState({ width: 1, height: 1 });
  const [now, setNow] = useState(() => new Date());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const stopCardRefs = useRef(new Map<string, HTMLElement>());

  const departureLimit = getDepartureLimit(stopIds.length);

  const { stops, stopsRef, loading: stopsLoading, error: stopsError } = useStopDepartures({
    stopIds,
    departureLimit,
  });

  const vehicleMqttTopics = useMemo(
    () => getVehicleMqttTopics(vehicleBounds),
    [vehicleBounds],
  );
  const { vehicles, status: vehicleStreamStatus } = useVehicleStream(vehicleMqttTopics);
  const digitransitApiKeyConfigured = Boolean(import.meta.env.VITE_DIGITRANSIT_API_KEY);

  const activeStops = useMemo(() => filterStopsWithActiveDepartures(stops, now), [stops, now]);
  const isStackedLayout = overlaySize.width < 768;
  const displayStops = useMemo(
    () => orderStopsByIds(activeStops, arrangedStopIds),
    [activeStops, arrangedStopIds],
  );

  const splitStackedSchedules =
    isStackedLayout &&
    !setupMode &&
    !editMode &&
    displayStops.length >= 3;
    
  const topDisplayStops = splitStackedSchedules ? displayStops.slice(0, 2) : displayStops;
  const bottomDisplayStops = splitStackedSchedules ? displayStops.slice(2) : [];
  const isStackedPhonePortrait = isStackedLayout && overlaySize.height >= overlaySize.width;
  const minDepartureRows = isStackedPhonePortrait ? 2 : 1;
  const maxDepartureRows = isStackedPhonePortrait ? getStackedPhoneDepartureRows(overlaySize) : undefined;
  
  const topStopBoardLayout = getStopBoardLayout(topDisplayStops.length, isStackedLayout);
  const bottomStopBoardLayout = getStopBoardLayout(bottomDisplayStops.length, isStackedLayout);
  
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
  }, [editMode, mapReady, mapRef, setEditStatus, setNearbyStops, setStopIds, stopIdsRef]);

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
        <section className="relative min-h-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/72 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md md:rounded-[2rem]">
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
                onUseLocation={() => handleBrowserLocation(mapRef)}
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
                onUseLocation={() => handleBrowserLocation(mapRef)}
                onRefreshNearby={() => refreshNearbyStops(mapRef)}
                onAddStop={(candidate) => setStopIds((current) => addStopId(current, candidate.gtfsId))}
                onRemoveStop={(stopId) => setStopIds((current) => current.filter((id) => id !== stopId))}
                onSave={saveEdits}
                onCancel={() => cancelEdits(mapRef)}
                onCopyLink={copyShareUrl}
                onReset={() => resetChoices(mapRef)}
                maxStopCount={MAX_STOP_COUNT}
              />
            ) : (
              <StopBoard
                stops={topDisplayStops}
                allDisplayStops={displayStops}
                layout={splitStackedSchedules ? topStopBoardLayout : topStopBoardLayout}
                testId="stop-board"
                stopCardRefs={stopCardRefs}
                minDepartureRows={minDepartureRows}
                maxDepartureRows={maxDepartureRows}
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
            className="relative min-h-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-950/72 p-2 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md sm:p-3 md:rounded-[2rem] md:p-4"
          >
            <StopBoard
              stops={bottomDisplayStops}
              allDisplayStops={displayStops}
              layout={bottomStopBoardLayout}
              testId="bottom-stop-board"
              stopCardRefs={stopCardRefs}
              minDepartureRows={minDepartureRows}
              maxDepartureRows={maxDepartureRows}
            />
          </section>
        ) : null}
      </div>

      <LeaderOverlay leaderLines={leaderLines} overlaySize={overlaySize} />

      {menuOpen ? (
        <AppMenu
          vehicleStreamStatus={vehicleStreamStatus}
          vehiclesCount={vehicles.size}
          viewport={viewport}
          stopIds={stopIds}
          shareUrl={shareUrl}
          shareStatus={shareStatus}
          digitransitApiKeyConfigured={digitransitApiKeyConfigured}
          onEdit={beginEditMode}
          onCopyLink={copyShareUrl}
          onReset={() => resetChoices(mapRef)}
        />
      ) : null}
    </div>
  );
}

function getFallbackVehicleBounds(viewport: ViewportState): VehicleBounds {
  return {
    north: viewport.lat + 0.01,
    south: viewport.lat - 0.01,
    east: viewport.lon + 0.01,
    west: viewport.lon - 0.01,
  };
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

function getShareUrl(viewport: ViewportState, stopIds: string[]) {
  return new URL(serializeUrlState({ viewport, stopIds }), window.location.href).toString();
}
