# Agent Notes

- When starting the dev server from WSL for Windows browser testing, bind Vite to all interfaces:
  `npm run dev -- --host 0.0.0.0 --port 5173`.
- Do not use Vite's default localhost-only bind for manual checks from Windows; Windows must be able to reach the WSL-hosted server.

## Project Map

- `src/App.tsx`: high-level app state, mode selection, setup/edit actions, data refresh orchestration, and layout composition.
- `src/hooks/useTransitMap.ts`: MapLibre ownership: HSL style boot, selected-stop and vehicle GeoJSON sources/layers, viewport and URL sync, user-vs-programmatic movement tracking, and delayed animated stop refit.
- `src/hooks/useLeaderOverlay.ts`: leader overlay measurement loop and subscriptions for map movement, map resize, window resize, and card/root resize.
- `src/components/StopBoard.tsx`: presentational stop board, stop cards, and departure rows.
- `src/components/LeaderOverlay.tsx`: SVG/frost rendering for leader ribbons.
- `src/api/digitransit.ts`: Digitransit GraphQL/geocoding calls for selected stops and nearby multimodal suggestions.
- `src/api/departureFilter.ts`: pickup/dropoff filtering for boardable departures.
- `src/lib/scheduleLayout.ts`: responsive schedule capacity, stacked layout ratios, and schedule row CSS variables.
- `src/lib/leaderRibbon.ts`: pure leader spine/ribbon polygon geometry.
- `src/lib/leaderOverlayGeometry.ts`: DOM/map measurement conversion into rendered leader ribbon data.
- `src/lib/mapFit.ts`: selected-stop bounds, fit keys, fit padding, map-fit test event, and easing constants.
- `src/lib/departures.ts`: active departure filtering, departure limits, stop ordering, and departure row keys.
- `src/lib/stopArrangement.ts`: projected map-position ordering for stop cards.
- `src/lib/vehicleGeoJson.ts`: realtime vehicle interpolation and GeoJSON conversion.
- `src/lib/urlState.ts`: URL parsing/serialization and stop-count cap.
- `src/lib/userConfig.ts`: browser local-storage config resolution and persistence.

## Test Surface

- `tests/leader-lines.spec.ts`: responsive layout, leader attachment, card/row overflow, and delayed animated map idle refit. The `pysakki-map-fit` window event exists for these timing assertions.
- `tests/layout-helpers.spec.ts`: pure schedule and stacked-layout budget checks.
- `tests/new-user-flow.spec.ts`: first-run, edit, location, reset, and duplicate-name direction hint flows.
- `tests/departure-filter.spec.ts`: boardable departure filtering.
- `tests/url-state.spec.ts`: URL parsing and serialization.

## Validation

- After structural or UI changes, run:
  `npm run build`
  `npm run lint`
  `npm run test:e2e -- tests/leader-lines.spec.ts tests/layout-helpers.spec.ts`
- Before finishing broad layout/map/data-flow work, run the full suite:
  `npm run test:e2e`
- Build may print a Vite chunk-size warning; that warning is expected unless bundle splitting is the task.

## Layout And Map Notes

- Preserve the kiosk-first, one-screen behavior. For small or odd displays, prefer readable unclipped schedule cards over maximizing departure row count.
- Stacked layouts intentionally give most vertical space to the map. Do not shrink the map just to show more rows unless the user explicitly asks.
- Keep leader IDs stable via `getLeaderId(stop, index)` and keep test IDs such as `leader-3d`, `leader-ribbon`, `stop-card`, and `departure-row` unless tests are updated with the change.
- Programmatic map moves must stay separate from user interaction tracking. Manual pan/zoom should pause auto-fit, then return selected stops with the delayed animated idle refit.
- If editing the HSL style loader, be careful with MapLibre glyph URLs: templated `{fontstack}` and `{range}` URLs must remain templated.
