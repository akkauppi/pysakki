import { AlertTriangle, Check, Copy, MapPinned, RotateCcw } from "lucide-react";
import { cn } from "../lib/cn";
import { Notice } from "./Notice";
import type { ViewportState } from "../lib/urlState";
import type { VehicleStreamStatus } from "../lib/useVehicleStream";

interface AppMenuProps {
  vehicleStreamStatus: VehicleStreamStatus;
  vehiclesCount: number;
  viewport: ViewportState;
  stopIds: string[];
  shareUrl: string;
  shareStatus: "idle" | "copied" | "manual";
  digitransitApiKeyConfigured: boolean;
  onEdit: () => void;
  onCopyLink: () => void;
  onReset: () => void;
}

export function AppMenu({
  vehicleStreamStatus,
  vehiclesCount,
  viewport,
  stopIds,
  shareUrl,
  shareStatus,
  digitransitApiKeyConfigured,
  onEdit,
  onCopyLink,
  onReset,
}: AppMenuProps) {
  return (
    <div className="absolute left-4 top-[4.75rem] z-30 w-[min(24rem,calc(100vw-2rem))] rounded-[1.6rem] border border-white/10 bg-slate-950/92 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur-xl md:left-5 md:top-[5.25rem]">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        Screen details
      </div>

      <div className="grid gap-3">
        <InfoRow label="Realtime" value={formatVehicleStreamStatus(vehicleStreamStatus)} />
        <InfoRow label="Vehicles" value={String(vehiclesCount)} />
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
          onClick={onEdit}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-300/16"
        >
          <MapPinned className="h-4 w-4" />
          Edit
        </button>
        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/10"
        >
          {shareStatus === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {shareStatus === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>

      <button
        type="button"
        data-testid="reset-choices"
        onClick={onReset}
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
