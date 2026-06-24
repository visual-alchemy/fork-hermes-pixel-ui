# Hermes Pixel UI Roadmap

## v0.2.0 — Stabilize & Fortify

- [x] TypeScript migration (App.tsx split, types, error boundary)
- [x] SQLite agent store + ghost agent fix
- [x] GitHub Actions CI (typecheck + test + docker build)
- [x] Label rendering fixes (clipping, dynamic sizing)
- [ ] **OfficeRenderer strict types** — 55 `implicit any` gaps, enable full strict mode
- [ ] **Docker healthcheck** — auto-restart on container crash
- [ ] **Integration tests** — WebSocket message parsing, layout activate/save flow, agent sorting

## v0.3.0 — Editor Quality

- [ ] **Undo history** — Ctrl+Z to undo furniture placement/removal
- [ ] **Keyboard shortcuts** — 1-6 for furniture tools, Esc to exit edit mode
- [ ] **Zoom / pan** — mouse wheel zoom, drag to pan canvas
- [ ] **More presets** — 2-3 new creative layouts
- [ ] **Agent search** — filter agent list in staff panel

## v0.4.0 — Visual Polish

- [ ] **Minimap** — corner overview of full office
- [ ] **Export as PNG** — screenshot current office to file
- [ ] **Movement trails** — ghost path lines behind walking agents
- [ ] **Preset import/export** — download/upload layout JSON
- [ ] **Server metrics endpoint** — `/api/health` with uptime, agent count, DB status

## v1.0.0 — Production Ready

- [ ] **Full test coverage** — >80% on hooks, components, server
- [ ] **Centralized error handling** — error boundary per panel, server error middleware
- [ ] **Rate limiting** — `/api/hermes-event` rate limit
- [ ] **Documentation** — setup guide, API docs, preset creation guide
- [ ] **Helm chart / docker compose production profile** — easy deploy anywhere
