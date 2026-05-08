import { type CSSProperties, type RefObject } from "react";
import { Bus, TrainFront, TramFront } from "lucide-react";
import type { StopWithDepartures } from "../api/digitransit";
import { cn } from "../lib/cn";
import { getDepartureKey } from "../lib/departures";
import { getLeaderId } from "../lib/leaderRibbon";
import { formatDepartureTime, formatRelativeMinutes } from "../lib/time";
import { registerStopCardRef } from "../lib/stopCardRefs";
import { useAutoFit } from "../hooks/useAutoFit";

const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;

export function StopBoard({
  stops,
  allDisplayStops,
  layout,
  testId,
  stopCardRefs,
  minDepartureRows = 1,
}: {
  stops: StopWithDepartures[];
  allDisplayStops: StopWithDepartures[];
  layout: CSSProperties;
  testId: string;
  stopCardRefs: RefObject<Map<string, HTMLElement>>;
  minDepartureRows?: number;
}) {
  return (
    <div
      data-testid={testId}
      className="grid h-full min-h-0 flex-1 gap-3"
      style={layout}
    >
      {stops.map((stop) => {
        const index = allDisplayStops.findIndex((displayStop) => displayStop.gtfsId === stop.gtfsId);
        const displayIndex = Math.max(0, index);
        return (
          <StopCard
            key={getLeaderId(stop, displayIndex)}
            stop={stop}
            displayIndex={displayIndex}
            stopCardRefs={stopCardRefs}
            minDepartureRows={minDepartureRows}
          />
        );
      })}
    </div>
  );
}

function StopCard({
  stop,
  displayIndex,
  stopCardRefs,
  minDepartureRows,
}: {
  stop: StopWithDepartures;
  displayIndex: number;
  stopCardRefs: RefObject<Map<string, HTMLElement>>;
  minDepartureRows: number;
}) {
  const color = STOP_MARKER_COLORS[displayIndex] ?? "#ffffff";
  const leaderId = getLeaderId(stop, displayIndex);
  
  const initialDepartureCount = Math.min(6, stop.departures.length);
  const minimumDepartureCount = Math.min(minDepartureRows, initialDepartureCount);
  const { containerRef: listRef, visibleCount } = useAutoFit(initialDepartureCount, {
    minCount: minimumDepartureCount,
  });
  
  const directionHint = formatStopDirectionHint(stop);
  const metadataDirection = stop.code && directionHint?.startsWith(stop.code)
    ? directionHint.slice(stop.code.length).replace(/^[\s·]+/, "").trim()
    : directionHint;
  const stopMeta = stop.code ?? "";

  return (
    <section
      data-testid="stop-card"
      className="stop-card-container relative z-30"
    >
      <div
        ref={(element) => {
          registerStopCardRef(stopCardRefs, leaderId, element);
        }}
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden border backdrop-blur-xl rounded-[1.5rem] p-3 sm:p-4",
          minDepartureRows >= 2 && "min-departure-card",
        )}
        style={getStopCardStyle(color)}
      >
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="stop-card-name truncate font-semibold text-white">
                  {stop.name}
                </div>
                {stopMeta || directionHint ? (
                  <div
                    data-testid="stop-direction-hint"
                    className="stop-card-meta truncate text-cyan-100/85 mt-0.5"
                  >
                    {[stopMeta, metadataDirection].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div
          ref={listRef as RefObject<HTMLDivElement>}
          className="departure-list flex-1 min-h-0"
          data-testid="departure-list"
          data-visible-departures={String(visibleCount)}
        >
          {stop.departures.slice(0, visibleCount).map((departure) => (
            <div
              key={getDepartureKey(stop.gtfsId, departure)}
              data-testid="departure-row"
              className="departure-row departure-row-motion grid grid-cols-[minmax(0,1fr)_auto]"
              style={getStopRowStyle(color)}
            >
              <div className="flex items-center gap-2 overflow-hidden min-w-0">
                <div data-testid="departure-mode-icon" className="departure-mode-icon flex h-8 w-8 items-center justify-center rounded-lg bg-black/20 shrink-0">
                  <ModeIcon mode={departure.routeMode} className="h-5 w-5" />
                </div>
                
                <div className="min-w-0 overflow-hidden">
                  <div className="flex items-baseline gap-2">
                    <span data-testid="departure-route" className="departure-route font-semibold text-white whitespace-nowrap">
                      {departure.routeShortName ?? departure.routeMode}
                    </span>
                    <span className="departure-headsign truncate text-slate-200 text-sm">{departure.headsign}</span>
                  </div>
                  <div data-testid="departure-scheduled-time" className="departure-scheduled-time truncate uppercase text-[10px] tracking-wider text-slate-300">
                    {formatDepartureTime(departure.serviceDay, departure.realtimeDeparture)}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div data-testid="departure-relative-time" className="departure-relative-time font-bold text-white tabular-nums">
                  {formatRelativeMinutes(departure.serviceDay, departure.realtimeDeparture)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
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

function formatStopDirectionHint(stop: Pick<StopWithDepartures, "code" | "directionHint">) {
  if (!stop.directionHint) {
    return null;
  }
  return [stop.code, `toward ${stop.directionHint}`].filter(Boolean).join(" · ");
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
