import type { Feature, FeatureCollection, Point } from "geojson";
import type { VehicleSnapshot } from "./useVehicleStream";

const VEHICLE_TRANSITION_MS = 900;

export function toVehicleCollection(
  vehicles: Map<string, VehicleSnapshot>,
  now: number,
): FeatureCollection<Point> {
  const features: Array<Feature<Point>> = Array.from(vehicles.values()).map((vehicle) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: interpolateCoordinates(vehicle, now),
    },
    properties: {
      id: vehicle.id,
      mode: vehicle.mode,
      label: vehicle.label,
      headsign: vehicle.headsign,
      bearing: interpolateHeading(vehicle, now),
    },
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

function interpolateCoordinates(vehicle: VehicleSnapshot, now: number): [number, number] {
  const progress = getVehicleTransitionProgress(vehicle, now);
  return [
    lerp(vehicle.previousLon, vehicle.lon, progress),
    lerp(vehicle.previousLat, vehicle.lat, progress),
  ];
}

function interpolateHeading(vehicle: VehicleSnapshot, now: number) {
  const progress = getVehicleTransitionProgress(vehicle, now);
  const delta = ((((vehicle.heading - vehicle.previousHeading) % 360) + 540) % 360) - 180;
  return (vehicle.previousHeading + delta * progress + 360) % 360;
}

function getVehicleTransitionProgress(vehicle: VehicleSnapshot, now: number) {
  const elapsed = now - vehicle.transitionStartedAt;
  return clamp(elapsed / VEHICLE_TRANSITION_MS, 0, 1);
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
