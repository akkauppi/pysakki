# Pysakki

Serverless Helsinki public transport map built with Vite, React, TypeScript, MapLibre GL JS, Digitransit GraphQL, and HSL realtime MQTT.

## What This Is

Pysakki is a small browser-based kiosk view for Helsinki public transport. The goal is simple: show a few selected stops, upcoming departures, and the nearby live map clearly on one screen.

This project was built iteratively and, to be frank, somewhat vibe-coded. It works, it is useful, and it has been shaped directly by real-world testing on the target display, but it should still be treated as a lightweight personal project rather than a polished transit product.

If you use it, please expect some rough edges, and please be kind if you open issues or suggestions.

## Current Focus

- single-screen kiosk display
- a few selected HSL stops at once
- large, readable departure information
- map context with realtime vehicles

## Project Status

- built for a practical real display, not as a generic framework
- intentionally small and dependency-light
- still evolving through hands-on use rather than formal product planning

## License

The code in this repository is available under the MIT License. See [LICENSE](./LICENSE).

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
npm run dev -- --host 0.0.0.0 --port 5173
```

When running from WSL and opening the app from Windows, do not bind Vite to
`127.0.0.1` inside WSL. Use `--host 0.0.0.0` so Windows localhost forwarding can
reach the dev server. Vite will print both `http://localhost:5173/` and WSL
network URLs; either can be used from the Windows host depending on local
forwarding behavior.

## Testing

Run the production build check:

```bash
npm run build
```

Run the Playwright layout smoke tests:

```bash
npm run test:e2e
```

If Playwright browsers are missing locally, install Chromium once:

```bash
npx playwright install chromium
```

## URL Parameters

- `lat`: map center latitude
- `lon`: map center longitude
- `zoom`: map zoom level
- `stops`: comma-separated stop references, using either GTFS IDs like `HSL:1040129` or HSL stop codes like `H0831`

If URL parameters are present, they override browser-saved configuration. If `stops` is omitted, the app uses browser-saved stops when available; otherwise it opens the first-run setup flow for choosing nearby tram stops.

Example:

```text
/?lat=60.17142&lon=24.94123&zoom=13.4&stops=H0831,H0446
```

The in-app menu and edit mode include a copy-link action that creates a shareable URL with the current `lat`, `lon`, `zoom`, and `stops`.

## Notes

- The app fetches the HSL map style from the public `hsl-map-style` repository and rewrites Digitransit tile URLs with the configured API key.
- Realtime vehicle positions are consumed directly in the browser from `wss://mqtt.hsl.fi:443/`.
- The schedule cards are intentionally capacity-aware: dense 3-4 stop layouts on small or unusual screens show fewer departures rather than clipping content.
- Leader-line behavior is covered by Playwright smoke tests across small portrait, small landscape, and desktop-ish viewport sizes.
- If Digitransit tightens key or CORS requirements, the style and GraphQL requests may need updated credentials or endpoint configuration.
- Attribution and data licenses from HSL Digitransit, OpenMapTiles, and OpenStreetMap must be kept visible in the UI.
