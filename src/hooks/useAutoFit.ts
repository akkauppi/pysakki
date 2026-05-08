import { useRef, useState, useLayoutEffect } from "react";

/**
 * A hook that empirically detects overflow in a container and adjusts a count
 * to fit as many items as possible.
 * 
 * @param initialCount The starting number of items to try to render
 * @param bufferPixels Optional safety margin
 * @returns {ref, visibleCount}
 */
export function useAutoFit(initialCount: number, bufferPixels = 4) {
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const containerRef = useRef<HTMLElement | null>(null);
  const lastDimensions = useRef({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkOverflow = () => {
      const { scrollHeight, clientHeight, scrollWidth, clientWidth } = container;
      const hasVerticalOverflow = scrollHeight > clientHeight + bufferPixels;
      const hasHorizontalOverflow = scrollWidth > clientWidth + bufferPixels;

      if (hasVerticalOverflow && visibleCount > 1) {
        setVisibleCount((prev) => prev - 1);
      } else if (!hasVerticalOverflow && !hasHorizontalOverflow && visibleCount < initialCount) {
        // Optimistically try to add one back if we have space
        // This is a bit tricky to do without oscillation, so we only do it
        // if we are sure there is enough "slack"
        const averageRowHeight = scrollHeight / Math.max(visibleCount, 1);
        if (clientHeight - scrollHeight > averageRowHeight + bufferPixels) {
          setVisibleCount((prev) => Math.min(initialCount, prev + 1));
        }
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width !== lastDimensions.current.width || height !== lastDimensions.current.height) {
          lastDimensions.current = { width, height };
          // When size changes, reset to initial and let it shrink again
          // or just trigger a check. Resetting is safer for density.
          setVisibleCount(initialCount);
        }
      }
    });

    observer.observe(container);
    checkOverflow();

    return () => observer.disconnect();
  }, [initialCount, visibleCount, bufferPixels]);

  return { containerRef, visibleCount };
}
