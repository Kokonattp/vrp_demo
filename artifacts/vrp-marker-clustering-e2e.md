# VRP marker clustering E2E evidence

Date: 2026-08-25
Target: local `http://127.0.0.1:3000/` with local backend on `127.0.0.1:8000`
Scope: browser-rendered runtime only; no production/provider/device claim

## Desktop browser

- Initial map after reload: zoom `11.50`, density `clustered`, visible HTML markers `1` (depot only).
- Three visible `Zoom in` clicks: zoom `13.50`, density `individual`, visible HTML markers `63` (62 stores + depot).
- Three visible `Zoom out` clicks: zoom `11.50`, density `clustered`, visible HTML markers `1`.
- Clicked the rendered cluster circle on the map canvas: zoom changed from `11.50` to `12.00` and remained in clustered mode, proving the cluster expansion interaction moved the map toward the cluster's expansion level.
- Screenshot review showed native cluster circles/counts and separate native point dots at zoomed-out state; store HTML markers were not piled over the map.
- Console `error` and `warn` entries: none.

## Mobile browser at 390x844

- Initial map after reload: zoom `11.50`, density `clustered`, visible HTML markers `1`.
- Three visible `Zoom in` clicks: zoom `13.50`, density `individual`, visible HTML markers `63`.
- Three visible `Zoom out` clicks: zoom `12.50`, density `clustered`, visible HTML markers `1`.
- `window.innerWidth=390`, `document.documentElement.scrollWidth=390`, `document.body.scrollWidth=390`.
- Console `error` and `warn` entries: none.

## Checks

- `npm --prefix frontend run lint`: PASS
- `npm --prefix frontend run build`: PASS
- `git diff --check`: PASS; only existing LF/CRLF normalization warnings were reported.
- Backend/provider E2E, authenticated E2E, device-native E2E, deployment, and production checks: NOT RUN / out of scope.

## Self-audit

- `frontend/src/components/vrp-map.tsx` is the only primary source file changed for this plan.
- Cluster source is built from the active `locations` prop, so the existing map scope remains authoritative.
- Depot stays as an HTML marker; selected store markers remain available for interaction while zoomed out.
- Cluster layers and their event handlers are cleaned up with the effect; the temporary browser viewport was reset and the temporary tab was closed after verification.
- No new dependency, backend change, data migration, push, deploy, or commit was performed.
