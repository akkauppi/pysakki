import { Check, Copy, Crosshair, LoaderCircle, LocateFixed, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { NearbyStopCandidate, StopWithDepartures } from "../api/digitransit";

export type AsyncUiState = "idle" | "loading" | "success" | "error";

interface EditStopsPanelProps {
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
  maxStopCount: number;
}

export function EditStopsPanel({
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
  maxStopCount,
}: EditStopsPanelProps) {
  const selectedStopMap = new Map(selectedStops.map((stop) => [stop.gtfsId, stop]));
  const canAddMore = selectedStopIds.length < maxStopCount;
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
          {selectedStopIds.length}/{maxStopCount}
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
