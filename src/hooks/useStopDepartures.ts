import { useEffect, useRef, useState } from "react";
import { fetchStopsWithDepartures, type StopWithDepartures } from "../api/digitransit";
import { filterStopsWithActiveDepartures } from "../lib/departures";

const STOP_REFRESH_INTERVAL_MS = 60_000;
const STOP_REFRESH_MIN_INTERVAL_MS = 15_000;

interface UseStopDeparturesProps {
  stopIds: string[];
  departureLimit: number;
  visibleDepartureCount: number;
  now: Date;
}

export function useStopDepartures({
  stopIds,
  departureLimit,
  visibleDepartureCount,
  now,
}: UseStopDeparturesProps) {
  const [stops, setStops] = useState<StopWithDepartures[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRefreshAtRef = useRef(0);
  const stopsRef = useRef<StopWithDepartures[]>([]);

  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    if (stopIds.length === 0) {
      setStops([]);
      setLoading(false);
      return;
    }

    const refreshStops = (showLoading: boolean) => {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      lastRefreshAtRef.current = Date.now();

      fetchStopsWithDepartures(stopIds, departureLimit)
        .then((result) => {
          if (!cancelled) {
            setStops(result);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setError(error instanceof Error ? error.message : "Departure data request failed.");
          }
        })
        .finally(() => {
          if (!cancelled && showLoading) {
            setLoading(false);
          }
        });
    };

    refreshStops(true);
    intervalId = window.setInterval(() => {
      refreshStops(false);
    }, STOP_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [departureLimit, stopIds]);

  // Handle underfilled rows (refresh if visible rows are empty but more might be available)
  useEffect(() => {
    if (stopIds.length === 0 || stops.length === 0) {
      return;
    }

    const activeStops = filterStopsWithActiveDepartures(stops, now);
    const hasUnderfilledVisibleRows = activeStops.some(
      (stop) => stop.departures.length < visibleDepartureCount,
    );
    const canRefresh = Date.now() - lastRefreshAtRef.current >= STOP_REFRESH_MIN_INTERVAL_MS;

    if (!hasUnderfilledVisibleRows || !canRefresh) {
      return;
    }

    let cancelled = false;
    lastRefreshAtRef.current = Date.now();

    fetchStopsWithDepartures(stopIds, departureLimit)
      .then((result) => {
        if (!cancelled) {
          setStops(result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Departure data request failed.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [departureLimit, now, stopIds, stops, visibleDepartureCount]);

  return {
    stops,
    stopsRef,
    loading,
    error,
  };
}
