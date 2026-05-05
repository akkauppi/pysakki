import { useEffect, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";

const MQTT_URL = "wss://mqtt.hsl.fi:443/";
const MQTT_TOPIC_OVERRIDE = import.meta.env.VITE_HSL_MQTT_TOPIC as string | undefined;
const MQTT_TOPIC_FALLBACK = "/hfp/v2/journey/ongoing/vp/+/+/+/+/+/+/+/+/+/+/+/+/+";
const MQTT_SHUTDOWN_DELAY_MS = 1_000;
const HFP_GEO_TOPIC_BUFFER_CELLS = 1;
const HFP_GEO_TOPIC_PRECISION = 100;

export type VehicleBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

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

export function useVehicleStream(topics: string[] = [MQTT_TOPIC_FALLBACK]) {
  const [vehicles, setVehicles] = useState<Map<string, VehicleSnapshot>>(new Map());
  const [status, setStatus] = useState<VehicleStreamStatus>("connecting");
  const topicKey = topics.join("\n");

  useEffect(() => {
    const client = getSharedClient();
    const subscribedTopics = topicKey.split("\n").filter(Boolean);
    sharedClientUsers += 1;

    setVehicles(new Map());
    setStatus(client.connected ? "connected" : "connecting");

    const handleConnect = () => {
      setStatus("connected");
      client.subscribe(subscribedTopics);
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

        const topicParts = topic.split("/").filter(Boolean);
        const mode = mapVehicleMode(topicParts[5] ?? "");
        const operator = vp.oper ?? "na";
        const id = `${mode}:${operator}:${vp.veh}`;
        const transitionStartedAt = Date.now();

        setVehicles((current) => {
          const next = new Map(current);
          const previous = next.get(id);
          const heading = vp.hdg ?? previous?.heading ?? 0;

          if (
            previous &&
            previous.lat === lat &&
            previous.lon === lon &&
            previous.heading === heading
          ) {
            next.set(id, {
              ...previous,
              label: vp.desi ?? String(vp.line ?? ""),
              headsign: vp.route ?? "",
              mode,
            });
            return next;
          }

          next.set(id, {
            id,
            lat,
            lon,
            heading,
            previousLat: previous?.lat ?? lat,
            previousLon: previous?.lon ?? lon,
            previousHeading: previous?.heading ?? heading,
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
      client.subscribe(subscribedTopics);
    }

    return () => {
      if (client.connected) {
        client.unsubscribe(subscribedTopics);
      }

      client.off("connect", handleConnect);
      client.off("reconnect", handleReconnect);
      client.off("close", handleClose);
      client.off("error", handleError);
      client.off("message", handleMessage);
      releaseSharedClient();
    };
  }, [topicKey]);

  return { vehicles, status };
}

export function getVehicleMqttTopics(bounds: VehicleBounds) {
  if (MQTT_TOPIC_OVERRIDE) {
    return MQTT_TOPIC_OVERRIDE.split(",").map((topic) => topic.trim()).filter(Boolean);
  }

  return getHfpGeographicTopics(bounds);
}

function getHfpGeographicTopics(bounds: VehicleBounds) {
  const topics = new Set<string>();

  const southCell = Math.floor(bounds.south * HFP_GEO_TOPIC_PRECISION) - HFP_GEO_TOPIC_BUFFER_CELLS;
  const northCell = Math.floor(bounds.north * HFP_GEO_TOPIC_PRECISION) + HFP_GEO_TOPIC_BUFFER_CELLS;
  const westCell = Math.floor(bounds.west * HFP_GEO_TOPIC_PRECISION) - HFP_GEO_TOPIC_BUFFER_CELLS;
  const eastCell = Math.floor(bounds.east * HFP_GEO_TOPIC_PRECISION) + HFP_GEO_TOPIC_BUFFER_CELLS;

  for (let latCell = southCell; latCell <= northCell; latCell += 1) {
    for (let lonCell = westCell; lonCell <= eastCell; lonCell += 1) {
      topics.add(getHfpGeographicTopic(latCell, lonCell));
    }
  }

  return Array.from(topics);
}

function getHfpGeographicTopic(latCell: number, lonCell: number) {
  const latDegree = Math.floor(latCell / HFP_GEO_TOPIC_PRECISION);
  const lonDegree = Math.floor(lonCell / HFP_GEO_TOPIC_PRECISION);
  const latTenth = Math.floor(positiveModulo(latCell, HFP_GEO_TOPIC_PRECISION) / 10);
  const lonTenth = Math.floor(positiveModulo(lonCell, HFP_GEO_TOPIC_PRECISION) / 10);
  const latHundredth = positiveModulo(latCell, 10);
  const lonHundredth = positiveModulo(lonCell, 10);

  return `/hfp/v2/journey/ongoing/vp/+/+/+/+/+/+/+/+/+/${latDegree};${lonDegree}/${latTenth}${lonTenth}/${latHundredth}${lonHundredth}/#`;
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
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
