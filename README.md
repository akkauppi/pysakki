# ratikka.sankari.fi

Serverless Helsinki public transport map built with Vite, React, TypeScript, MapLibre GL JS, Digitransit GraphQL, and HSL realtime MQTT.

## What This Is

ratikka.sankari.fi is a small browser-based kiosk view for Helsinki public transport. The goal is simple: show a few selected departures, upcoming times, and the nearby live map clearly on one screen.

This project was built iteratively and, to be frank, somewhat vibe-coded. It works, it is useful, and it has been shaped directly by real-world testing on the target display, but it should still be treated as a lightweight personal project rather than a polished transit product.

If you use it, please expect some rough edges, and please be kind if you open issues or suggestions.

## Current Focus

- single-screen kiosk display
- selected HSL bus, tram, train, and metro departures
- large, readable departure information
- map context with realtime vehicles
- first-run setup and later stop editing directly in the browser

## Project Status

- built for a practical real display, not as a generic framework
- intentionally small and dependency-light
- still evolving through hands-on use rather than formal product planning

## Using The App

On first run, the app opens a setup flow instead of assuming default choices. You can use browser location to pick nearby departures, or choose manually from the map. The app stores the selected stop references and viewport in browser local storage after you press Done.

The in-app menu shows the current realtime status, viewport, selected references, and share URL. From there you can edit selections, copy the current link, or reset choices. Reset clears the saved browser configuration and returns to first-run setup.

Edit mode can refresh nearby bus, tram, train, and metro suggestions for the current map center, add the nearest transit stop when you tap the map, remove selected entries, cancel back to the previous saved choices, or save the edited choices into local storage and the URL.

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

Run lint:

```bash
npm run lint
```

Run the focused Playwright smoke tests:

```bash
npm run test:e2e
```

The browser suite keeps cheap unit-style coverage for URL state, departure
filtering, and stacked layout metrics, then uses a smaller set of UI checks for
the risky pieces: 2-stop phone stacking, 3-4 stop split stacking, a short phone,
a landscape weird viewport, desktop leader attachment, first-run/edit flows, and
the delayed map reset after manual interaction.

If Playwright browsers are missing locally, install Chromium once:

```bash
npx playwright install chromium
```

## URL Parameters

- `lat`: map center latitude
- `lon`: map center longitude
- `zoom`: map zoom level
- `stops`: comma-separated stop references, using either GTFS IDs like `HSL:1040129` or HSL stop codes like `H0831`

URL parameters override browser-saved configuration independently: `stops` overrides saved selections, and any of `lat`, `lon`, or `zoom` overrides the saved viewport. If `stops` is omitted, the app uses browser-saved selections when available; otherwise it opens the first-run setup flow for choosing nearby departures.

Example:

```text
/?lat=60.17142&lon=24.94123&zoom=13.4&stops=H0831,H0446
```

The in-app menu and edit mode include a copy-link action that creates a shareable URL with the current `lat`, `lon`, `zoom`, and `stops`.

## Notes

- The app fetches the HSL map style from the public `hsl-map-style` repository and rewrites Digitransit tile URLs with the configured API key.
- Realtime vehicle positions are consumed directly in the browser from `wss://mqtt.hsl.fi:443/`.
- Stop departure lists exclude Digitransit rows where boarding is not allowed.
- Duplicate or ambiguous stop names can show a compact direction hint based on the dominant upcoming headsign.
- The schedule cards are intentionally capacity-aware: dense 3-4 selection layouts on small or unusual screens simplify row details before clipping content.
- On stacked layouts, the map intentionally gets most of the screen: roughly 60-65% for 1-2 stop phones, and roughly 55-60% for split 3-4 stop phones after panel chrome and gaps.
- On tall stacked layouts with 3-4 stops, cards can split between top and bottom boards so leader lines do not cross.
- The app fits selected stops automatically when the initial selection or layout changes. After manual map pan or zoom, automatic fitting pauses and returns slowly after about five seconds of map idle time.
- Leader-line, layout, and setup/edit behavior is covered by Playwright smoke tests across small portrait, small landscape, and desktop-ish viewport sizes.
- If Digitransit tightens key or CORS requirements, the style and GraphQL requests may need updated credentials or endpoint configuration.
- Attribution and data licenses from HSL Digitransit, OpenMapTiles, and OpenStreetMap must be kept visible in the UI.
