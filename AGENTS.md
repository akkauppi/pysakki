# Agent Notes

- When starting the dev server from WSL for Windows browser testing, bind Vite to all interfaces:
  `npm run dev -- --host 0.0.0.0 --port 5173`.
- Do not use Vite's default localhost-only bind for manual checks from Windows; Windows must be able to reach the WSL-hosted server.
