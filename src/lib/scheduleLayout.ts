import type { CSSProperties } from "react";

export type ScreenSize = {
  width: number;
  height: number;
};

export type ScheduleRowVariant = "full" | "compactIcon" | "compact";

export type ScheduleFit = {
  visibleCount: number;
  scale: number;
  contentScale: number;
  rowVariant: ScheduleRowVariant;
  rowHeight: number;
};

export type StackedLayoutMetrics = {
  mapRatio: number;
  topBoardRatio: number;
  bottomBoardRatio: number;
  gridTemplateRows: string;
  scheduleBoardHeight: number;
};

export function getStackedLayoutMetrics(
  stopCount: number,
  screenSize: ScreenSize,
  splitStackedSchedules: boolean,
): StackedLayoutMetrics {
  if (splitStackedSchedules) {
    const mapRatio = screenSize.height < 700 ? 0.57 : 0.59;
    const boardRatio = (1 - mapRatio) / 2;
    return {
      mapRatio,
      topBoardRatio: boardRatio,
      bottomBoardRatio: boardRatio,
      gridTemplateRows: `minmax(0, ${boardRatio.toFixed(3)}fr) minmax(0, ${mapRatio.toFixed(3)}fr) minmax(0, ${boardRatio.toFixed(3)}fr)`,
      scheduleBoardHeight: screenSize.height * boardRatio,
    };
  }

  const landscape = screenSize.height < screenSize.width;
  const mapRatio = landscape ? 0.62 : stopCount <= 2 ? 0.65 : 0.62;
  const boardRatio = 1 - mapRatio;
  return {
    mapRatio,
    topBoardRatio: boardRatio,
    bottomBoardRatio: 0,
    gridTemplateRows: `minmax(0, ${boardRatio.toFixed(3)}fr) minmax(0, ${mapRatio.toFixed(3)}fr)`,
    scheduleBoardHeight: screenSize.height * boardRatio,
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

export function getScheduleFit(
  stopCount: number,
  maxDepartureCount: number,
  isStackedLayout: boolean,
  screenSize: ScreenSize,
  previousRowVariant: ScheduleRowVariant,
  hasDirectionHints: boolean,
  splitStackedSchedules = false,
): ScheduleFit {
  const minScale = isStackedLayout ? 0.88 : stopCount >= 4 && screenSize.height < 720 ? 0.86 : stopCount >= 3 && screenSize.height < 720 ? 0.9 : 0.96;
  const maxScale = isStackedLayout ? 1.22 : 1.34;
  const minComfortInset = isStackedLayout ? 4 : stopCount >= 4 && screenSize.height < 720 ? 3 : stopCount >= 3 ? 4 : 8;
  // Map-first stacked layouts deliberately spend more vertical space on the map.
  // The remaining schedule budget may reduce row count so cards stay readable and unclipped.
  const boardHeight = isStackedLayout
    ? Math.max(0, getStackedLayoutMetrics(stopCount, screenSize, splitStackedSchedules).scheduleBoardHeight - (splitStackedSchedules ? 68 : 82))
    : screenSize.height - 118;
  const layoutRows = isStackedLayout ? (stopCount <= 2 || splitStackedSchedules ? 1 : 2) : Math.max(stopCount, 1);
  const cardHeight = boardHeight / Math.max(layoutRows, 1) - getScheduleCardSafetyReserve(stopCount, isStackedLayout);
  const maxDepartureCountForViewport = !isStackedLayout && stopCount >= 3 && screenSize.height < 720
    ? Math.min(maxDepartureCount, 2)
    : maxDepartureCount;
  const maxCandidate = Math.max(0, maxDepartureCountForViewport);
  const minVisibleCount = Math.min(maxCandidate, 1);
  const widthScale = screenSize.width < 390 ? 0.98 : 1;
  const variants = getScheduleVariantPriority(stopCount, isStackedLayout, screenSize.height, previousRowVariant);

  if (maxCandidate === 0) {
    return {
      visibleCount: 0,
      scale: minScale,
      contentScale: minScale,
      rowVariant: "compact",
      rowHeight: 0,
    };
  }

  if (
    isStackedLayout &&
    boardHeight / Math.max(layoutRows, 1) <
      getScheduleHeaderReserve(stopCount, 1, hasDirectionHints) +
        getScheduleMinimumRowHeight(1, "compact", minComfortInset)
  ) {
    return {
      visibleCount: 0,
      scale: minScale,
      contentScale: minScale,
      rowVariant: "compact",
      rowHeight: 0,
    };
  }

  for (let visibleCount = maxCandidate; visibleCount >= minVisibleCount; visibleCount -= 1) {
    const headerReserve = getScheduleHeaderReserve(stopCount, visibleCount, hasDirectionHints);
    const rowGap = getScheduleBaseListGap(visibleCount);
    const rowBudget = (cardHeight - headerReserve - rowGap * Math.max(0, visibleCount - 1)) / visibleCount;
    const targetRowHeight = getScheduleTargetRowHeight(visibleCount);
    const rowHeight = Math.min(rowBudget, targetRowHeight * maxScale);

    for (const rowVariant of variants) {
      if (rowBudget >= getScheduleMinimumRowHeight(visibleCount, rowVariant, minComfortInset)) {
        const resolvedScale = clamp(rowHeight / targetRowHeight, minScale, maxScale);
        return {
          visibleCount,
          scale: resolvedScale,
          contentScale: clamp(resolvedScale * widthScale, minScale, maxScale),
          rowVariant,
          rowHeight,
        };
      }
    }
  }

  const fallbackHeaderReserve = getScheduleHeaderReserve(stopCount, minVisibleCount, hasDirectionHints);
  const fallbackRowGap = getScheduleBaseListGap(minVisibleCount);
  const fallbackRowBudget = Math.max(
    getScheduleMinimumRowHeight(minVisibleCount, "compact", minComfortInset),
    (cardHeight - fallbackHeaderReserve - fallbackRowGap * Math.max(0, minVisibleCount - 1)) / Math.max(1, minVisibleCount),
  );
  const fallbackTargetHeight = getScheduleTargetRowHeight(minVisibleCount);
  const fallbackScale = clamp(fallbackRowBudget / fallbackTargetHeight, minScale, maxScale);

  return {
    visibleCount: minVisibleCount,
    scale: fallbackScale,
    contentScale: clamp(fallbackScale * widthScale, minScale, maxScale),
    rowVariant: "compact",
    rowHeight: fallbackRowBudget,
  };
}

export function getScheduleScaleStyle(
  fit: ScheduleFit,
  compactSchedule: boolean,
): CSSProperties {
  const { scale, contentScale, rowVariant, rowHeight, visibleCount } = fit;
  const hasIcon = rowVariant !== "compact";
  const compactContentScale = rowVariant === "compact"
    ? Math.min(contentScale, Math.max(0.72, rowHeight / 48))
    : contentScale;
  const rowPadX = hasIcon ? (compactSchedule ? 9 : 12) : 8;
  const rowPadY = hasIcon ? (compactSchedule ? 7 : 13) : rowHeight < 40 ? 3 : 4;
  const iconSize = compactSchedule ? 34 : 48;
  const modeIconSize = compactSchedule ? 22 : 28;
  const rowGap = hasIcon ? (compactSchedule ? 8 : 12) : 8;
  const listGap = hasIcon ? (compactSchedule ? 6 : 8) : 6;
  const resolvedRowHeight = rowVariant === "compact" ? Math.min(rowHeight, 48) : rowHeight;
  const comfortableIconSize = Math.max(0, rowHeight - 14);
  const resolvedIconSize = Math.min(Math.max(24, Math.round(iconSize * contentScale)), comfortableIconSize);
  const maxRowRadius = rowVariant === "compact" ? 12 : compactSchedule ? 14 : 18;

  return {
    gap: `${Math.max(3, Math.round(listGap * scale))}px`,
    gridTemplateRows: visibleCount > 0 ? `repeat(${visibleCount}, var(--schedule-row-height))` : undefined,
    alignContent: "start",
    "--schedule-row-gap": `${Math.max(4, Math.round(rowGap * scale))}px`,
    "--schedule-row-px": `${Math.max(8, Math.round(rowPadX * scale))}px`,
    "--schedule-row-py": `${Math.max(hasIcon ? 6 : 4, Math.round(rowPadY * scale))}px`,
    "--schedule-row-radius": `${Math.max(6, Math.min(maxRowRadius, Math.round(resolvedRowHeight * 0.3)))}px`,
    "--schedule-icon-radius": `${Math.max(10, Math.round(16 * contentScale))}px`,
    "--schedule-icon-size": `${Math.round(resolvedIconSize)}px`,
    "--schedule-mode-icon-size": `${Math.max(16, Math.round(modeIconSize * contentScale))}px`,
    "--schedule-route-size": `${(hasIcon ? (compactSchedule ? 1.42 * contentScale : 1.72 * contentScale) : 1.34 * compactContentScale).toFixed(3)}rem`,
    "--schedule-headsign-size": `${(hasIcon ? (compactSchedule ? 0.86 * contentScale : 0.94 * contentScale) : 0.82 * compactContentScale).toFixed(3)}rem`,
    "--schedule-time-size": `${(compactSchedule ? 0.72 * contentScale : 0.78 * contentScale).toFixed(3)}rem`,
    "--schedule-relative-size": `${(hasIcon ? (compactSchedule ? 1.54 * contentScale : 2.0 * contentScale) : 1.42 * compactContentScale).toFixed(3)}rem`,
    "--schedule-time-mt": `${Math.max(2, Math.round(4 * contentScale))}px`,
    "--schedule-time-tracking": compactSchedule ? "0.12em" : "0.18em",
    "--schedule-row-height": `${Math.max(hasIcon ? 44 : 30, Math.round(resolvedRowHeight))}px`,
  } as CSSProperties;
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

function getScheduleVariantPriority(
  stopCount: number,
  isStackedLayout: boolean,
  screenHeight: number,
  previousRowVariant: ScheduleRowVariant,
): ScheduleRowVariant[] {
  if (!isStackedLayout) {
    if (screenHeight >= 900) {
      return ["full"];
    }

    if (stopCount >= 3 && screenHeight < 720) {
      return ["compact"];
    }

    return ["full", "compactIcon", "compact"];
  }

  if (stopCount >= 3 || screenHeight < 720) {
    return ["compact"];
  }

  if (screenHeight >= 760 || previousRowVariant === "compactIcon" || previousRowVariant === "full") {
    return stopCount >= 4 ? ["compact", "compactIcon"] : ["compactIcon", "compact"];
  }

  return ["compact"];
}

function getScheduleHeaderReserve(stopCount: number, visibleCount: number, hasDirectionHints: boolean) {
  const directionReserve = hasDirectionHints && stopCount < 3 ? 14 : 0;
  if (visibleCount <= 1) {
    return (stopCount >= 3 ? 26 : 48) + directionReserve;
  }

  return (stopCount >= 3 ? 30 : 64) + directionReserve;
}

function getScheduleCardSafetyReserve(stopCount: number, isStackedLayout: boolean) {
  if (isStackedLayout) {
    return stopCount >= 3 ? 8 : 14;
  }

  if (stopCount >= 4) {
    return 24;
  }

  return stopCount >= 3 ? 14 : 18;
}

function getScheduleBaseListGap(visibleCount: number) {
  if (visibleCount <= 1) {
    return 4;
  }

  return visibleCount <= 2 ? 6 : 8;
}

function getScheduleTargetRowHeight(visibleCount: number) {
  if (visibleCount <= 1) {
    return 54;
  }

  return visibleCount <= 2 ? 58 : 76;
}

function getScheduleMinimumRowHeight(
  visibleCount: number,
  rowVariant: ScheduleRowVariant,
  minComfortInset: number,
) {
  if (rowVariant === "full") {
    return (visibleCount <= 2 ? 54 : 58) + minComfortInset * 2;
  }

  if (rowVariant === "compactIcon") {
    return (visibleCount <= 2 ? 42 : 46) + minComfortInset * 2;
  }

  return 24 + minComfortInset * 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
