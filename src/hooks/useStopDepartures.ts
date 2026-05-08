import { useEffect, useRef, useState } from "react";
import { fetchStopsWithDepartures, type StopWithDepartures } from "../api/digitransit";

const STOP_REFRESH_INTERVAL_MS = 60_000;

interface UseStopDeparturesProps {
  stopIds: string[];
  departureLimit: number;
}

export function useStopDepartures({
  stopIds,
  departureLimit,
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

  return {
    stops,
    stopsRef,
    loading,
    error,
  };
}
