import { useEffect, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";

const MQTT_URL = "wss://mqtt.hsl.fi:443/";
const MQTT_TOPIC =
  import.meta.env.VITE_HSL_MQTT_TOPIC ??
  "/hfp/v2/journey/ongoing/vp/+/+/+/+/+/+/+/+/+/+/+/+/+";
const MQTT_SHUTDOWN_DELAY_MS = 1_000;

type VehiclePositionPayload = {
  VP?: {
    desi?: string;
    dir?: string;
    oper?: number;
    veh?: number;
    hdg?: number;
    lat?: number;
    long?: number;
    route?: string;
    line?: number | string;
    tsi?: number;
  };
};

export type VehicleSnapshot = {
  id: string;
  lat: number;
  lon: number;
  heading: number;
  previousLat: number;
  previousLon: number;
  previousHeading: number;
  transitionStartedAt: number;
  label: string;
  headsign: string;
  mode: "BUS" | "TRAM" | "RAIL" | "SUBWAY";
};

export type VehicleStreamStatus = "connecting" | "connected" | "disconnected" | "error";

let sharedClient: MqttClient | null = null;
let sharedClientUsers = 0;
let shutdownTimer: number | null = null;

export function useVehicleStream() {
  const [vehicles, setVehicles] = useState<Map<string, VehicleSnapshot>>(new Map());
  const [status, setStatus] = useState<VehicleStreamStatus>("connecting");

  useEffect(() => {
    const client = getSharedClient();
    sharedClientUsers += 1;

    setStatus(client.connected ? "connected" : "connecting");

    const handleConnect = () => {
      setStatus("connected");
      client.subscribe(MQTT_TOPIC);
    };

    const handleReconnect = () => {
      setStatus("connecting");
    };

    const handleClose = () => {
      setStatus("disconnected");
    };

    const handleError = () => {
      setStatus("error");
    };

    const handleMessage = (topic: string, payloadBuffer: Buffer) => {
      try {
        const payload = JSON.parse(payloadBuffer.toString()) as VehiclePositionPayload;
        const vp = payload.VP;
        if (vp?.veh == null || vp.lat == null || vp.long == null) {
          return;
        }

        const lat = vp.lat;
        const lon = vp.long;

        const topicParts = topic.split("/");
        const mode = mapVehicleMode(topicParts[5] ?? "");
        const operator = vp.oper ?? "na";
        const id = `${mode}:${operator}:${vp.veh}`;
        const transitionStartedAt = Date.now();

        setVehicles((current) => {
          const next = new Map(current);
          const previous = next.get(id);
          next.set(id, {
            id,
            lat,
            lon,
            heading: vp.hdg ?? 0,
            previousLat: previous?.lat ?? lat,
            previousLon: previous?.lon ?? lon,
            previousHeading: previous?.heading ?? (vp.hdg ?? 0),
            transitionStartedAt,
            label: vp.desi ?? String(vp.line ?? ""),
            headsign: vp.route ?? "",
            mode,
          });

          if (next.size > 2500) {
            const keys = next.keys();
            for (let index = 0; index < 250; index += 1) {
              const key = keys.next().value;
              if (!key) {
                break;
              }
              next.delete(key);
            }
          }

          return next;
        });
      } catch {
        return;
      }
    };

    client.on("connect", handleConnect);
    client.on("reconnect", handleReconnect);
    client.on("close", handleClose);
    client.on("error", handleError);
    client.on("message", handleMessage);

    if (client.connected) {
      client.subscribe(MQTT_TOPIC);
    }

    return () => {
      client.off("connect", handleConnect);
      client.off("reconnect", handleReconnect);
      client.off("close", handleClose);
      client.off("error", handleError);
      client.off("message", handleMessage);
      releaseSharedClient();
    };
  }, []);

  return { vehicles, status };
}

function mapVehicleMode(mode: string): VehicleSnapshot["mode"] {
  switch (mode.toLowerCase()) {
    case "tram":
      return "TRAM";
    case "train":
      return "RAIL";
    case "metro":
      return "SUBWAY";
    default:
      return "BUS";
  }
}

function getSharedClient() {
  if (shutdownTimer !== null) {
    window.clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  if (!sharedClient) {
    sharedClient = mqtt.connect(MQTT_URL, {
      clientId: `pysakki-${Math.random().toString(36).slice(2, 10)}`,
      protocolVersion: 4,
      reconnectPeriod: 2_000,
      connectTimeout: 10_000,
      clean: true,
    });
  }

  return sharedClient;
}

function releaseSharedClient() {
  sharedClientUsers = Math.max(0, sharedClientUsers - 1);
  if (sharedClientUsers > 0 || !sharedClient) {
    return;
  }

  shutdownTimer = window.setTimeout(() => {
    sharedClient?.end(true);
    sharedClient = null;
    shutdownTimer = null;
  }, MQTT_SHUTDOWN_DELAY_MS);
}
