import type { CSSProperties, RefObject } from "react";
import { Bus, TrainFront, TramFront } from "lucide-react";
import type { StopWithDepartures } from "../api/digitransit";
import { cn } from "../lib/cn";
import { getDepartureKey } from "../lib/departures";
import { getLeaderId } from "../lib/leaderRibbon";
import { formatDepartureTime, formatRelativeMinutes } from "../lib/time";
import type { ScheduleFit } from "../lib/scheduleLayout";
import { registerStopCardRef } from "../lib/stopCardRefs";

const STOP_MARKER_COLORS = ["#34d399", "#38bdf8", "#f59e0b", "#f472b6"] as const;

export function StopBoard({
  stops,
  allDisplayStops,
  layout,
  testId,
  stopCardRefs,
  visibleDepartureCount,
  scheduleFit,
  scheduleScaleStyle,
  compactSchedule,
  denseScheduleHeader,
  ultraCompactSchedule,
  emptySchedule,
  showModeIcon,
  showHeadsign,
  showScheduledTime,
}: {
  stops: StopWithDepartures[];
  allDisplayStops: StopWithDepartures[];
  layout: CSSProperties;
  testId: string;
  stopCardRefs: RefObject<Map<string, HTMLElement>>;
  visibleDepartureCount: number;
  scheduleFit: ScheduleFit;
  scheduleScaleStyle: CSSProperties;
  compactSchedule: boolean;
  denseScheduleHeader: boolean;
  ultraCompactSchedule: boolean;
  emptySchedule: boolean;
  showModeIcon: boolean;
  showHeadsign: boolean;
  showScheduledTime: boolean;
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
        );
      })}
    </div>
  );
}

function StopCard({
  stop,
  displayIndex,
  stopCardRefs,
  visibleDepartureCount,
  scheduleFit,
  scheduleScaleStyle,
  compactSchedule,
  denseScheduleHeader,
  ultraCompactSchedule,
  emptySchedule,
  showModeIcon,
  showHeadsign,
  showScheduledTime,
}: {
  stop: StopWithDepartures;
  displayIndex: number;
  stopCardRefs: RefObject<Map<string, HTMLElement>>;
  visibleDepartureCount: number;
  scheduleFit: ScheduleFit;
  scheduleScaleStyle: CSSProperties;
  compactSchedule: boolean;
  denseScheduleHeader: boolean;
  ultraCompactSchedule: boolean;
  emptySchedule: boolean;
  showModeIcon: boolean;
  showHeadsign: boolean;
  showScheduledTime: boolean;
}) {
  const color = STOP_MARKER_COLORS[displayIndex] ?? "#ffffff";
  const leaderId = getLeaderId(stop, displayIndex);
  const directionHint = formatStopDirectionHint(stop, denseScheduleHeader || ultraCompactSchedule);
  const metadataDirection = stop.code && directionHint?.startsWith(stop.code)
    ? directionHint.slice(stop.code.length).replace(/^[\s·]+/, "").trim()
    : directionHint;
  const stopMeta = stop.code ?? "";

  return (
    <section
      data-testid="stop-card"
      ref={(element) => registerStopCardRef(stopCardRefs, leaderId, element)}
      className={cn(
        "relative z-30 flex min-h-0 flex-col overflow-hidden border backdrop-blur-xl",
        ultraCompactSchedule ? "rounded-[1.1rem]" : compactSchedule ? "rounded-[1.25rem]" : "rounded-[1.5rem]",
        emptySchedule ? "p-1.5" : ultraCompactSchedule ? "p-1.5" : compactSchedule ? "p-1.5" : "p-3.5 sm:p-4",
      )}
      style={getStopCardStyle(color)}
    >
      <div className={cn("flex items-start gap-2", emptySchedule ? "mb-0" : ultraCompactSchedule ? "mb-0" : compactSchedule ? "mb-0" : "mb-2.5")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={cn("truncate font-semibold text-white", emptySchedule ? "text-[clamp(0.78rem,2.2vw,0.92rem)] leading-none" : denseScheduleHeader ? "text-[clamp(0.8rem,2.2vw,0.98rem)] leading-none" : ultraCompactSchedule ? "text-[clamp(0.8rem,2.4vw,0.96rem)] leading-none" : compactSchedule ? "text-[clamp(0.9rem,2.4vw,1.08rem)] leading-tight" : "text-[clamp(1.05rem,1.35vw,1.35rem)] leading-tight")}>
                {stop.name}
              </div>
              {stopMeta || directionHint ? (
                <div
                  data-testid="stop-direction-hint"
                  className={cn("truncate text-cyan-100/85", denseScheduleHeader || ultraCompactSchedule ? "mt-0.5 text-[9px] leading-none" : "mt-1 text-xs leading-4")}
                >
                  {[stopMeta, metadataDirection].filter(Boolean).join(" · ")}
                </div>
              ) : null}
            </div>
          </div>
          {stop.desc && !compactSchedule && !directionHint ? (
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
        data-schedule-scale={scheduleFit.scale.toFixed(2)}
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
            style={getStopRowStyle(color)}
          >
            {showModeIcon ? (
              <div data-testid="departure-mode-icon" className="flex h-[var(--schedule-icon-size)] w-[var(--schedule-icon-size)] items-center justify-center rounded-[var(--schedule-icon-radius)] bg-black/20">
                <ModeIcon mode={departure.routeMode} className="h-[var(--schedule-mode-icon-size)] w-[var(--schedule-mode-icon-size)]" />
              </div>
            ) : null}

            <div className="min-w-0 overflow-hidden">
              <div className="flex items-end gap-2">
                <span data-testid="departure-route" className="text-[length:var(--schedule-route-size)] font-semibold leading-none text-white">
                  {departure.routeShortName ?? departure.routeMode}
                </span>
                {showHeadsign ? (
                  <span className="truncate pb-0.5 text-[length:var(--schedule-headsign-size)] leading-none text-slate-200">{departure.headsign}</span>
                ) : null}
              </div>
              {showScheduledTime ? (
                <div data-testid="departure-scheduled-time" className="mt-[var(--schedule-time-mt)] truncate uppercase text-[length:var(--schedule-time-size)] leading-tight tracking-[var(--schedule-time-tracking)] text-slate-300">
                  {formatDepartureTime(departure.serviceDay, departure.realtimeDeparture)}
                </div>
              ) : null}
            </div>

            <div className="text-right">
              <div data-testid="departure-relative-time" className="text-[length:var(--schedule-relative-size)] font-semibold leading-none text-white tabular-nums">
                {formatRelativeMinutes(departure.serviceDay, departure.realtimeDeparture)}
              </div>
            </div>
          </div>
        ))}
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

function formatStopDirectionHint(stop: Pick<StopWithDepartures, "code" | "directionHint">, compact: boolean) {
  if (!stop.directionHint) {
    return null;
  }

  const destination = compact ? shortenDirectionHint(stop.directionHint) : stop.directionHint;
  return [stop.code, compact ? `→ ${destination}` : `toward ${destination}`].filter(Boolean).join(compact ? " " : " · ");
}

function shortenDirectionHint(value: string) {
  const withoutPrefix = value.replace(/^kohti\s+/i, "").replace(/^towards?\s+/i, "");
  return withoutPrefix.length <= 18 ? withoutPrefix : `${withoutPrefix.slice(0, 17).trim()}…`;
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
