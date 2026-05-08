import type { CSSProperties } from "react";

export type ScreenSize = {
  width: number;
  height: number;
};

export type StackedLayoutMetrics = {
  mapRatio: number;
  topBoardRatio: number;
  bottomBoardRatio: number;
  gridTemplateRows: string;
  scheduleBoardHeight: number;
};

/**
 * Calculates the responsive grid layout metrics for the stacked (mobile/portrait) kiosk view.
 * 
 * In stacked mode, split phone portraits reserve enough schedule space for two
 * full departure rows before assigning the remaining height to the map.
 */
export function getStackedLayoutMetrics(
  stopCount: number,
  screenSize: ScreenSize,
  splitStackedSchedules: boolean,
): StackedLayoutMetrics {
  const appPadding = 16; // p-2 is 8px * 2
  const gridGap = 8;     // gap-2 is 8px
  const effectiveHeight = screenSize.height - appPadding;

  if (splitStackedSchedules) {
    const totalGaps = gridGap * 2;
    const availableHeight = Math.max(1, effectiveHeight - totalGaps);
    const minimumTopBoardHeight = 260;
    const minimumBottomBoardHeight = 210;
    const minimumMapHeight = 120;
    const reservedHeight = minimumTopBoardHeight + minimumBottomBoardHeight + minimumMapHeight;
    const extraHeight = Math.max(0, availableHeight - reservedHeight);
    const scale = availableHeight < reservedHeight ? availableHeight / reservedHeight : 1;

    const topBoardHeight = minimumTopBoardHeight * scale + extraHeight * 0.15;
    const bottomBoardHeight = minimumBottomBoardHeight * scale + extraHeight * 0.15;
    const mapHeight = Math.max(1, availableHeight - topBoardHeight - bottomBoardHeight);
    const topBoardRatio = topBoardHeight / availableHeight;
    const bottomBoardRatio = bottomBoardHeight / availableHeight;
    const mapRatio = mapHeight / availableHeight;

    return {
      mapRatio,
      topBoardRatio,
      bottomBoardRatio,
      gridTemplateRows: `minmax(0, ${topBoardRatio.toFixed(3)}fr) minmax(0, ${mapRatio.toFixed(3)}fr) minmax(0, ${bottomBoardRatio.toFixed(3)}fr)`,
      scheduleBoardHeight: Math.min(topBoardHeight, bottomBoardHeight),
    };
  }

  // 1-2 stops: Single board at the top.
  const landscape = screenSize.height < screenSize.width;
  const mapRatio = landscape ? 0.62 : stopCount <= 2 ? 0.65 : 0.62;
  const boardRatio = 1 - mapRatio;
  const totalGaps = gridGap;
  const boardHeight = (effectiveHeight - totalGaps) * boardRatio;

  return {
    mapRatio,
    topBoardRatio: boardRatio,
    bottomBoardRatio: 0,
    gridTemplateRows: `minmax(0, ${boardRatio.toFixed(3)}fr) minmax(0, ${mapRatio.toFixed(3)}fr)`,
    scheduleBoardHeight: boardHeight,
  };
}

export function getAppGridStyle({
  isStackedLayout,
  screenSize,
  splitStackedSchedules,
  stopCount,
}: {
  isStackedLayout: boolean;
  screenSize: ScreenSize;
  splitStackedSchedules: boolean;
  stopCount: number;
}): CSSProperties | undefined {
  if (!isStackedLayout) {
    return undefined;
  }

  return {
    gridTemplateRows: getStackedLayoutMetrics(stopCount, screenSize, splitStackedSchedules).gridTemplateRows,
  };
}

export function getStopBoardLayout(stopCount: number, isStackedLayout: boolean) {
  if (!isStackedLayout) {
    return {
      gridTemplateRows: `repeat(${Math.max(stopCount, 1)}, minmax(0, 1fr))`,
    };
  }

  if (stopCount <= 1) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }

  if (stopCount === 2) {
    return {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gridTemplateRows: "minmax(0, 1fr)",
    };
  }

  return {
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gridTemplateRows: "repeat(2, minmax(0, 1fr))",
  };
}
