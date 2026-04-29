# Reitti

Serverless Helsinki public transport map built with Vite, React, TypeScript, MapLibre GL JS, Digitransit GraphQL, and HSL realtime MQTT.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local env file:

```bash
cp .env.example .env.local
```

3. Add a Digitransit subscription key to `VITE_DIGITRANSIT_API_KEY`.
   It is used for both GraphQL stop departures and stop-code resolution via Digitransit geocoding.

4. Start the app:

```bash
npm run dev
```

## URL Parameters

- `lat`: map center latitude
- `lon`: map center longitude
- `zoom`: map zoom level
- `stops`: comma-separated stop references, using either GTFS IDs like `HSL:1040129` or HSL stop codes like `H0831`

If `stops` is omitted, the app defaults to `H0831,H0446`.

Example:

```text
/?lat=60.17142&lon=24.94123&zoom=13.4&stops=H0831,H0446
```

## Notes

- The app fetches the HSL map style from the public `hsl-map-style` repository and rewrites Digitransit tile URLs with the configured API key.
- Realtime vehicle positions are consumed directly in the browser from `wss://mqtt.hsl.fi:443/`.
- If Digitransit tightens key or CORS requirements, the style and GraphQL requests may need updated credentials or endpoint configuration.
