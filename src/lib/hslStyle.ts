import type { StyleSpecification } from "maplibre-gl";

const styleUrl =
  import.meta.env.VITE_HSL_STYLE_URL ??
  "https://cdn.jsdelivr.net/gh/HSLdevcom/hsl-map-style@master/style.json";

let stylePromise: Promise<StyleSpecification> | null = null;

export async function loadHslStyle(): Promise<StyleSpecification> {
  if (!stylePromise) {
    stylePromise = fetchHslStyle().catch((error: unknown) => {
      stylePromise = null;
      throw error;
    });
  }

  return cloneStyle(await stylePromise);
}

async function fetchHslStyle(): Promise<StyleSpecification> {
  const response = await fetch(styleUrl);
  if (!response.ok) {
    throw new Error(`Style request failed with ${response.status}.`);
  }

  const style = (await response.json()) as StyleSpecification;
  return rewriteStyle(style, response.url || styleUrl);
}

function rewriteStyle(style: StyleSpecification, resolvedStyleUrl: string): StyleSpecification {
  const key = import.meta.env.VITE_DIGITRANSIT_API_KEY as string | undefined;
  const styleBaseUrl = resolvedStyleUrl.slice(0, resolvedStyleUrl.lastIndexOf("/") + 1);

  const addQuery = (url: string) => {
    if (!key || !url.startsWith("https://")) {
      return url;
    }

    if (url.includes("digitransit-subscription-key=")) {
      return url;
    }

    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}digitransit-subscription-key=${encodeURIComponent(key)}`;
  };

  const resolveAssetUrl = (value: string | undefined) => {
    if (!value) {
      return value;
    }

    if (/^https?:\/\//.test(value)) {
      return addQuery(value);
    }

    if (value.startsWith("//")) {
      return addQuery(`https:${value}`);
    }

    const absoluteUrl = `${styleBaseUrl}${value.replace(/^\.\//, "")}`;
    return addQuery(absoluteUrl);
  };

  const rewrittenSources = Object.fromEntries(
    Object.entries(style.sources).map(([sourceName, source]) => {
      if ("url" in source && typeof source.url === "string") {
        return [sourceName, { ...source, url: resolveAssetUrl(source.url) }];
      }

      if ("tiles" in source && Array.isArray(source.tiles)) {
        return [
          sourceName,
          {
            ...source,
            tiles: source.tiles.map((tileUrl) => resolveAssetUrl(tileUrl) ?? tileUrl),
          },
        ];
      }

      return [sourceName, source];
    }),
  ) as StyleSpecification["sources"];

  return {
    ...style,
    sprite: typeof style.sprite === "string" ? resolveAssetUrl(style.sprite) : style.sprite,
    glyphs: typeof style.glyphs === "string" ? resolveAssetUrl(style.glyphs) : style.glyphs,
    sources: rewrittenSources,
  };
}

function cloneStyle(style: StyleSpecification): StyleSpecification {
  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}
