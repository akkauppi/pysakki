import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { StopWithDepartures } from "../api/digitransit";
import {
  computeLeaderRibbons,
  getLeaderOverlaySize,
  type LeaderRibbon,
} from "../lib/leaderOverlayGeometry";
import { getArrangedStopIds } from "../lib/stopArrangement";

export function useLeaderOverlay({
  mapReady,
  displayStops,
  stopsLength,
  rootRef,
  mapShellRef,
  mapRef,
  stopCardRefs,
  setArrangedStopIds,
  setOverlaySize,
  stopsRef,
  colors,
}: {
  mapReady: boolean;
  displayStops: StopWithDepartures[];
  stopsLength: number;
  rootRef: RefObject<HTMLDivElement | null>;
  mapShellRef: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<MapLibreMap | null>;
  stopCardRefs: RefObject<Map<string, HTMLElement>>;
  setArrangedStopIds: Dispatch<SetStateAction<string[]>>;
  setOverlaySize: Dispatch<SetStateAction<{ width: number; height: number }>>;
  stopsRef: RefObject<StopWithDepartures[]>;
  colors: readonly string[];
}) {
  const [leaderLines, setLeaderLines] = useState<LeaderRibbon[]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mapReady || displayStops.length === 0 || !rootRef.current || !mapShellRef.current || !mapRef.current) {
      setLeaderLines([]);
      return;
    }

    const updateLeaderLines = () => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const root = rootRef.current;
        const mapShell = mapShellRef.current;
        const map = mapRef.current;

        if (!root || !mapShell || !map) {
          return;
        }

        const rootRect = root.getBoundingClientRect();
        const mapUsesStackedLayout = rootRect.width < 768;
        setArrangedStopIds((current) => getArrangedStopIds(stopsRef.current, map, mapUsesStackedLayout, current));
        setOverlaySize(getLeaderOverlaySize(root));
        setLeaderLines(computeLeaderRibbons({
          root,
          mapShell,
          map,
          displayStops,
          stopCount: stopsLength,
          stopCardRefs: stopCardRefs.current,
          colors,
        }));
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

    if (resizeObserver && rootRef.current && mapShellRef.current) {
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
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [colors, displayStops, mapReady, mapRef, mapShellRef, rootRef, setArrangedStopIds, setOverlaySize, stopCardRefs, stopsLength, stopsRef]);

  return { leaderLines };
}
