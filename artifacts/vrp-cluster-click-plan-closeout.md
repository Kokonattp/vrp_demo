# VRP cluster-click plan closeout

Status: `PLAN_CLOSED`
Date: 2026-08-25
Candidate: `vrp-cluster-click-20260825-c`
Base revision: `6851b0856c67822cdf9dbdc5bd286c7116c194c5`

## Objective/result

Hardened the MapLibre cluster interaction so native circle/count clicks and accessible HTML hit targets share the same guarded `getClusterExpansionZoom` path. Fixed the style-load lifecycle race that left cluster layers absent in responsive runs, increased the cluster radius to provide usable targets, and verified desktop/mobile zoom round-trips.

## Files inspected/changed

- Changed: `frontend/src/components/vrp-map.tsx`.
- Durable truth: `PROJECT_MEMORY.md`.
- Evidence: `artifacts/vrp-cluster-click-release-task-contract.md`, `artifacts/vrp-cluster-click-e2e.md`, `artifacts/vrp-cluster-click-self-audit.md`, this closeout.
- Excluded: `frontend/src/app/layout.tsx`, `frontend/src/app/opengraph-image.tsx`, `data/`, browser profile exports, screenshots/logs/PDFs, and unrelated dirty paths.

## Checks/evidence

- Lint, build, Python syntax, and diff checks: PASS.
- Local backend/frontend health: PASS; runtime stopped and generated sync file moved to Recycle Bin.
- Desktop: native rendered clusters ready, circle coordinate click and accessible count click expanded to `12.25`, high zoom reached `14.25` with individual markers, console clean.
- Mobile 390x844: accessible cluster click at dense zoom expanded to `9.25`, high zoom reached `14.25`, returned to clustered state, no horizontal overflow, console clean.

## Decisions/risks

- Continue using MapLibre; replacing it would be a separate architecture project.
- HTML hit targets are an intentional accessibility/overlay fallback, not a second clustering truth.
- Provider, authenticated, device-native, production, and 3D gates remain separate.

## Final release state

The cluster-click source/memory/evidence commit and the Vercel upload-boundary commit are pushed to `origin/main`. Vercel production is `READY` at `https://vrp-demo.vercel.app`; page, `/api/health`, and desktop/mobile count-label smoke passed. The backend subtree push to the `hf` remote succeeded, but `https://nattp-vrp-demo-api.hf.space/health` returns HTTP 404, so backend production health remains blocked pending owner recovery/confirmation of the Space.

Status: `PLAN_PAUSED` — frontend release verified; backend runtime reachability is not verified.
