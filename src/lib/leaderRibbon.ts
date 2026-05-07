import type { StopWithDepartures } from "../api/digitransit";

export type ScreenPoint = {
  x: number;
  y: number;
};

export type LeaderCardAnchorSide = "right" | "top" | "bottom";

export type LeaderRibbonGeometry = {
  polygon: string;
  cssPolygon: string;
  stopX: number;
  stopY: number;
  cardX: number;
  cardY: number;
  stopRadius: number;
};

export function getLeaderId(stop: StopWithDepartures, index: number) {
  return `${stop.gtfsId}-${index}`;
}

export function toSvgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function getLeaderRibbonWidths(stopCount: number, isStackedLayout: boolean, screenWidth: number) {
  const densityScale = stopCount >= 3 ? 0.72 : 1;
  const screenScale = screenWidth < 520 ? 0.56 : screenWidth < 768 ? 0.68 : 1;
  const layoutScale = isStackedLayout ? 0.76 : 1;
  const scale = densityScale * screenScale * layoutScale;

  return {
    start: Math.max(12, Math.round(22 * scale)),
    end: Math.max(28, Math.round(96 * scale)),
  };
}

export function buildLeaderRibbon({
  stopPoint,
  cardRect,
  mapRect,
  widths,
  cardAnchorSide,
}: {
  stopPoint: ScreenPoint;
  cardRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  mapRect: { left: number; top: number; width: number; height: number };
  widths: { start: number; end: number };
  cardAnchorSide: LeaderCardAnchorSide;
}): LeaderRibbonGeometry {
  const cardAnchor = getLeaderCardAnchor(cardRect, cardAnchorSide);
  const spinePoints = cardAnchorSide === "right"
    ? buildDesktopLeaderSpine(stopPoint, cardAnchor)
    : buildStackedLeaderSpine(stopPoint, cardAnchor, mapRect, cardAnchorSide);
  const ribbonPoints = buildRibbonPolygonPoints(
    spinePoints,
    spinePoints.map((_, index) => {
      if (index === 0) {
        return widths.start;
      }

      if (index === spinePoints.length - 1) {
        return widths.end;
      }

      return widths.end * 0.74;
    }),
  );

  return {
    polygon: toPolygonPoints(ribbonPoints),
    cssPolygon: toCssPolygonPoints(ribbonPoints),
    stopX: stopPoint.x,
    stopY: stopPoint.y,
    cardX: cardAnchor.x,
    cardY: cardAnchor.y,
    stopRadius: Math.max(4, widths.start * 0.34),
  };
}

function buildDesktopLeaderSpine(stopPoint: ScreenPoint, cardAnchor: ScreenPoint) {
  const dropX = cardAnchor.x + 56;

  return [
    stopPoint,
    { x: dropX, y: cardAnchor.y },
    cardAnchor,
  ];
}

function getLeaderCardAnchor(
  cardRect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  side: LeaderCardAnchorSide,
) {
  if (side === "right") {
    return {
      x: cardRect.right,
      y: cardRect.top + cardRect.height * 0.5,
    };
  }

  return {
    x: cardRect.left + cardRect.width * 0.5,
    y: side === "top" ? cardRect.top : cardRect.bottom,
  };
}

function buildStackedLeaderSpine(
  stopPoint: ScreenPoint,
  cardAnchor: ScreenPoint,
  mapRect: { left: number; top: number; width: number; height: number },
  cardAnchorSide: Exclude<LeaderCardAnchorSide, "right">,
) {
  const dropY = cardAnchorSide === "top"
    ? Math.min(cardAnchor.y - 44, mapRect.top + mapRect.height - 10)
    : Math.max(cardAnchor.y + 44, mapRect.top + 10);

  return [
    stopPoint,
    { x: cardAnchor.x, y: dropY },
    cardAnchor,
  ];
}

function buildRibbonPolygonPoints(
  points: ScreenPoint[],
  widths: number[],
) {
  if (points.length < 2) {
    return [];
  }

  const left: ScreenPoint[] = [];
  const right: ScreenPoint[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const halfWidth = (widths[index] ?? widths[widths.length - 1] ?? 0) / 2;

    if (index === 0) {
      const normal = getSegmentNormal(points[0], points[1]);
      left.push(offsetPoint(point, normal, halfWidth));
      right.push(offsetPoint(point, normal, -halfWidth));
      continue;
    }

    if (index === points.length - 1) {
      const normal = getSegmentNormal(points[index - 1], point);
      left.push(offsetPoint(point, normal, halfWidth));
      right.push(offsetPoint(point, normal, -halfWidth));
      continue;
    }

    left.push(getJoinedOffsetPoint(points[index - 1], point, points[index + 1], halfWidth));
    right.push(getJoinedOffsetPoint(points[index - 1], point, points[index + 1], -halfWidth));
  }

  return [...left, ...right.reverse()];
}

function getJoinedOffsetPoint(prev: ScreenPoint, point: ScreenPoint, next: ScreenPoint, offset: number) {
  const incomingNormal = getSegmentNormal(prev, point);
  const outgoingNormal = getSegmentNormal(point, next);
  const incomingStart = offsetPoint(prev, incomingNormal, offset);
  const incomingEnd = offsetPoint(point, incomingNormal, offset);
  const outgoingStart = offsetPoint(point, outgoingNormal, offset);
  const outgoingEnd = offsetPoint(next, outgoingNormal, offset);

  return getLineIntersection(incomingStart, incomingEnd, outgoingStart, outgoingEnd) ?? outgoingStart;
}

function getSegmentNormal(start: ScreenPoint, end: ScreenPoint) {
  const tangent = normalize({
    x: end.x - start.x,
    y: end.y - start.y,
  });

  return {
    x: -tangent.y,
    y: tangent.x,
  };
}

function offsetPoint(point: ScreenPoint, normal: ScreenPoint, offset: number) {
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset,
  };
}

function getLineIntersection(a1: ScreenPoint, a2: ScreenPoint, b1: ScreenPoint, b2: ScreenPoint) {
  const aDx = a2.x - a1.x;
  const aDy = a2.y - a1.y;
  const bDx = b2.x - b1.x;
  const bDy = b2.y - b1.y;
  const denominator = aDx * bDy - aDy * bDx;

  if (Math.abs(denominator) < 0.001) {
    return null;
  }

  const progress = ((b1.x - a1.x) * bDy - (b1.y - a1.y) * bDx) / denominator;

  return {
    x: a1.x + progress * aDx,
    y: a1.y + progress * aDy,
  };
}

function toPolygonPoints(points: ScreenPoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function toCssPolygonPoints(points: ScreenPoint[]) {
  return points.map((point) => `${point.x}px ${point.y}px`).join(", ");
}

function normalize(vector: { x: number; y: number }) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) {
    return { x: 0, y: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}
