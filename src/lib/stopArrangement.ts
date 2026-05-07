import type { Map as MapLibreMap } from "maplibre-gl";
import type { StopWithDepartures } from "../api/digitransit";
import { mergeArrangedStopIds, sameStringList } from "./departures";

export function getArrangedStopIds(
  stops: StopWithDepartures[],
  map: MapLibreMap,
  isStackedLayout: boolean,
  current: string[],
) {
  if (stops.length <= 1) {
    return mergeArrangedStopIds(current, stops);
  }

  const next = [...stops]
    .sort((a, b) => {
      const aPoint = map.project([a.lon, a.lat]);
      const bPoint = map.project([b.lon, b.lat]);
      const primaryDelta = isStackedLayout ? aPoint.x - bPoint.x : aPoint.y - bPoint.y;
      if (Math.abs(primaryDelta) > 1) {
        return primaryDelta;
      }

      return isStackedLayout ? aPoint.y - bPoint.y : aPoint.x - bPoint.x;
    })
    .map((stop) => stop.gtfsId);

  return sameStringList(current, next) ? current : next;
}
