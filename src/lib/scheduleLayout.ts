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
 * In stacked mode, we prioritize the map context (60-65% of screen) and distribute the remaining
 * space to one or two schedule boards.
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
    // 3-4 stops: Split into top and bottom boards.
    const mapRatio = screenSize.height < 700 ? 0.48 : 0.50;
    const boardRatio = (1 - mapRatio) / 2;
    const totalGaps = gridGap * 2;
    const boardHeight = (effectiveHeight - totalGaps) * boardRatio;

    return {
      mapRatio,
      topBoardRatio: boardRatio,
      bottomBoardRatio: boardRatio,
      gridTemplateRows: `minmax(0, ${boardRatio.toFixed(3)}fr) minmax(0, ${mapRatio.toFixed(3)}fr) minmax(0, ${boardRatio.toFixed(3)}fr)`,
      scheduleBoardHeight: boardHeight,
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
