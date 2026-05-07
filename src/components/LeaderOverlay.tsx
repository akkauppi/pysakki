import type { CSSProperties } from "react";
import type { LeaderRibbon } from "../lib/leaderOverlayGeometry";

export function LeaderOverlay({
  leaderLines,
  overlaySize,
}: {
  leaderLines: LeaderRibbon[];
  overlaySize: { width: number; height: number };
}) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
        {leaderLines.map((line) => (
          <div
            key={`${line.id}-frost`}
            data-testid="leader-frost"
            className="absolute inset-0"
            style={getLeaderFrostStyle(line)}
          />
        ))}
      </div>

      <svg
        className="pointer-events-none absolute inset-0 z-20 block"
        aria-hidden="true"
        viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`}
        preserveAspectRatio="none"
      >
        {leaderLines.map((line) => (
          <g key={line.id} data-testid="leader-3d">
            <defs>
              <linearGradient id={`${line.svgId}-deck`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e0faff" stopOpacity="0.18" />
                <stop offset="24%" stopColor={line.color} stopOpacity="0.16" />
                <stop offset="66%" stopColor="#0f3558" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#020617" stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f8fdff" stopOpacity="0.34" />
                <stop offset="22%" stopColor="#7dd3fc" stopOpacity="0.48" />
                <stop offset="64%" stopColor={line.color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={line.color} stopOpacity="0.16" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-highlight`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
                <stop offset="34%" stopColor="#bae6fd" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#bae6fd" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${line.svgId}-lower-shadow`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#020617" stopOpacity="0" />
                <stop offset="58%" stopColor="#020617" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#020617" stopOpacity="0.18" />
              </linearGradient>
              <filter id={`${line.svgId}-glow`} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feColorMatrix
                  in="blur"
                  type="matrix"
                  values="0 0 0 0 0.49 0 0 0 0 0.83 0 0 0 0 0.98 0 0 0 0.17 0"
                />
              </filter>
              <filter id={`${line.svgId}-shadow`} x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
                <feDropShadow dx="0" dy="10" stdDeviation="11" floodColor="#020617" floodOpacity="0.26" />
              </filter>
              <clipPath id={`${line.svgId}-clip`}>
                <polygon points={line.polygon} />
              </clipPath>
            </defs>
            <polygon
              data-testid="leader-glow"
              points={line.polygon}
              fill="none"
              stroke={withAlpha("#7dd3fc", 0.2)}
              strokeWidth="4"
              strokeLinejoin="round"
              filter={`url(#${line.svgId}-glow)`}
            />
            <polygon
              data-testid="leader-soft-shadow"
              points={line.polygon}
              fill={withAlpha("#020617", 0.12)}
              stroke="none"
              filter={`url(#${line.svgId}-shadow)`}
            />
            <polygon
              data-testid="leader-ribbon"
              points={line.polygon}
              fill={`url(#${line.svgId}-deck)`}
              stroke={`url(#${line.svgId}-rim)`}
              strokeWidth="1"
              strokeLinejoin="round"
              opacity="0.72"
            />
            <polygon
              data-testid="leader-inner-shadow"
              points={line.polygon}
              fill={`url(#${line.svgId}-lower-shadow)`}
              stroke="none"
              clipPath={`url(#${line.svgId}-clip)`}
              opacity="0.86"
            />
            <polygon
              data-testid="leader-highlight"
              points={line.polygon}
              fill="none"
              stroke={`url(#${line.svgId}-highlight)`}
              strokeWidth="0.45"
              strokeLinejoin="round"
              opacity="0.72"
            />
            <circle
              data-testid="leader-stop-cap"
              cx={line.stopX}
              cy={line.stopY}
              r={line.stopRadius}
              fill={line.color}
              stroke="#ffffff"
              strokeWidth="1.5"
              opacity="0.92"
            />
          </g>
        ))}
      </svg>
    </>
  );
}

function getLeaderFrostStyle(line: LeaderRibbon) {
  return {
    clipPath: `polygon(${line.cssPolygon})`,
    WebkitClipPath: `polygon(${line.cssPolygon})`,
    backdropFilter: "blur(5px) saturate(1.16)",
    WebkitBackdropFilter: "blur(5px) saturate(1.16)",
    background: [
      `linear-gradient(135deg, ${withAlpha("#e0faff", 0.12)}, ${withAlpha(line.color, 0.1)} 40%, ${withAlpha("#020617", 0.18)} 100%)`,
      `linear-gradient(45deg, ${withAlpha("#7dd3fc", 0.08)}, ${withAlpha("#0f172a", 0.12)})`,
    ].join(", "),
    boxShadow: [
      `0 0 4px ${withAlpha("#7dd3fc", 0.12)}`,
      `inset 0 1px 0 ${withAlpha("#ffffff", 0.14)}`,
      `inset 0 -12px 24px ${withAlpha("#020617", 0.16)}`,
    ].join(", "),
  } as CSSProperties;
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return hex;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
