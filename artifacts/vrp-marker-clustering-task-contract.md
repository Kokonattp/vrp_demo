# VRP marker clustering task contract

Status: SOL GATE: READY
Date: 2026-08-25

## Objective

Prevent store markers from piling up when the VRP map is zoomed out, while preserving depot visibility, route scope, marker selection, popup, and drag behavior when zoomed in.

## Current behavior

`frontend/src/components/vrp-map.tsx` renders every location as an HTML `maplibregl.Marker`. The map already supports scoped/all-location fitting, route layers, selected locations, and draggable markers, but there is no zoom-aware decluttering layer.

## In scope

- `frontend/src/components/vrp-map.tsx`
- Browser-rendered E2E evidence and this task's closeout/contract under `D:\VRP\artifacts\`

## Out of scope / forbidden

- Backend routing, optimizer behavior, data files, authentication, provider configuration, MiroFish/scenario behavior, deployment, push, and production changes.
- New runtime dependencies unless the existing MapLibre version cannot provide the required behavior.
- Changes to unrelated pre-existing worktree modifications.

## Design

- Add a MapLibre GeoJSON source with native clustering for scoped store locations only.
- Render cluster circles and counts at zoomed-out levels; keep the depot HTML marker visible.
- Hide store HTML markers below the individual-marker threshold, restore them above it, and keep a selected store visible for interaction.
- Clicking a cluster uses `getClusterExpansionZoom` and animates to the cluster center.
- Expose concise user-facing density status so the behavior is understandable and testable: clustered by zoom versus individual markers.

## Acceptance criteria

1. At the map's zoomed-out state, store HTML markers do not pile up; cluster layers/counts represent the scoped store points and the depot remains visible.
2. Clicking a rendered cluster zooms toward its expansion level; no runtime error occurs.
3. At the zoomed-in threshold, individual store markers return with existing popup, selection, route numbering, and dragging behavior intact.
4. Existing scope controls (`ซูมจุดในขอบเขต`, `ดูทุกจุด`, `รีเซ็ตมุมมอง`) continue to work and the active route/map scope is unchanged.
5. Desktop and 390px mobile browser states have no horizontal overflow caused by the new status/control copy.
6. Focused browser E2E records zoom-out, zoom-in, and zoom-out-again evidence, visible marker counts/status, screenshots, and console logs.

## Verification plan

- Source/diff: inspect only the scoped component and diff check.
- Focused checks: `npm --prefix frontend run lint`; `npm --prefix frontend run build`.
- Browser runtime/E2E: run local backend/frontend, use the browser-rendered app at desktop and 390px, exercise zoom controls and cluster state, capture screenshots and console logs.
- Backend/provider/device/production E2E: NOT RUN / out of scope.

## Rollback

Revert only the changes in `frontend/src/components/vrp-map.tsx` and the task artifact files. Preserve all unrelated worktree changes.

## Definition of Done

Implementation, focused checks, browser E2E evidence, a fresh self-audit, and a plan closeout are complete. No push or deployment is performed in this task.
