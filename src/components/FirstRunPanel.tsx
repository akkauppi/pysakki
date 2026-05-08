import { LoaderCircle, LocateFixed, MapPinned } from "lucide-react";

export type AsyncUiState = "idle" | "loading" | "success" | "error";

interface FirstRunPanelProps {
  locationStatus: AsyncUiState;
  onUseLocation: () => void;
  onChooseOnMap: () => void;
}

export function FirstRunPanel({
  locationStatus,
  onUseLocation,
  onChooseOnMap,
}: FirstRunPanelProps) {
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
