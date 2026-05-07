import type { Map as MapLibreMap } from "maplibre-gl";
import type { StopWithDepartures } from "../api/digitransit";
import {
  buildLeaderRibbon,
  getLeaderId,
  getLeaderRibbonWidths,
  toSvgId,
  type LeaderCardAnchorSide,
} from "./leaderRibbon";

export type LeaderRibbon = {
  id: string;
  svgId: string;
  color: string;
  polygon: string;
  cssPolygon: string;
  stopX: number;
  stopY: number;
  cardX: number;
  cardY: number;
  stopRadius: number;
};

export function computeLeaderRibbons({
  root,
  mapShell,
  map,
  displayStops,
  stopCount,
  stopCardRefs,
  colors,
}: {
  root: HTMLElement;
  mapShell: HTMLElement;
  map: MapLibreMap;
  displayStops: StopWithDepartures[];
  stopCount: number;
  stopCardRefs: Map<string, HTMLElement>;
  colors: readonly string[];
}): LeaderRibbon[] {
  const rootRect = root.getBoundingClientRect();
  const mapRect = mapShell.getBoundingClientRect();

  return displayStops.flatMap((stop, index) => {
    const leaderId = getLeaderId(stop, index);
    const card = stopCardRefs.get(leaderId);
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
    const mapBottom = mapTop + mapHeight;
    const cardAnchorSide: LeaderCardAnchorSide = mapIsToRight
      ? "right"
      : cardTop >= mapBottom - 12
        ? "top"
        : "bottom";
    const ribbonWidths = getLeaderRibbonWidths(stopCount, cardAnchorSide !== "right", rootRect.width);
    const stopPoint = {
      x: clamp(mapLeft + projected.x, mapLeft + 24, mapLeft + mapWidth - 24),
      y: clamp(mapTop + projected.y, mapTop + 24, mapTop + mapHeight - 24),
    };
    const leader = buildLeaderRibbon({
      stopPoint,
      cardRect: {
        left: cardLeft,
        top: cardTop,
        right: cardRight,
        bottom: cardBottom,
        width: cardRect.width,
        height: cardRect.height,
      },
      mapRect: {
        left: mapLeft,
        top: mapTop,
        width: mapWidth,
        height: mapHeight,
      },
      widths: ribbonWidths,
      cardAnchorSide,
    });

    return [
      {
        id: leaderId,
        svgId: toSvgId(leaderId),
        color: colors[index] ?? "#ffffff",
        ...leader,
      },
    ];
  });
}

export function getLeaderOverlaySize(root: HTMLElement) {
  const rootRect = root.getBoundingClientRect();
  return {
    width: Math.max(1, Math.ceil(rootRect.width)),
    height: Math.max(1, Math.ceil(rootRect.height)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
