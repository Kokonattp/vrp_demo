# VRP map context and operational POI release task contract

Status: SOL GATE: READY
Date: 2026-08-25
Candidate ID: vrp-map-context-20260825-a
Base revision: fcb0c80dab3e4c73e540452fc68338ab230d739d
Checkout: D:\VRP (sequential exception; existing unrelated dirty files preserved)

## Objective

Make the map context complete enough for dispatch review: show/hide basemap building and place/POI context, keep operational delivery/depot points readable with existing zoom clustering, explain the provenance of each context layer, and prove the controls in rendered desktop/mobile browser E2E before commit/push.

## Current behavior and verified context

- The map uses the remote CARTO Positron style and already has route, traffic, depot/store, and native marker-cluster layers.
- The current CARTO style exposes vector building layers (`building`, `building-top`), place-label layers backed by `place`, and POI layers backed by `poi`; these are basemap context, not VRP operational truth.
- Project-owned operational points come from the active `locations` prop and master data. The dataset does not yet contain verified building entrances/loading bays, so the UI must not invent them.

## In scope

- Add zoom-safe controls and state for basemap buildings, places/POIs, and project operational points.
- Toggle matching style layers without replacing the remote basemap or making basemap context part of route calculation.
- Keep existing marker clustering, depot visibility, route scope, popups, selection, and mobile layout intact.
- Add concise provenance/disclosure copy and test hooks useful to users and E2E.
- Update project memory and create release evidence/closeout artifacts.
- Commit and push the approved candidate to the configured `origin` remote after final gates pass.

## Out of scope / forbidden

- 3D buildings, digital-twin terrain, new external POI downloads, Google/Mapbox POI enrichment, scraping, auth, migrations, backend API changes, routing mathematics, deployment, production configuration, and unrelated dirty files.
- Do not present basemap buildings/POIs as verified delivery entrances or operational constraints.
- Do not stage `frontend/src/app/layout.tsx`, `frontend/src/app/opengraph-image.tsx`, `data/`, Chrome profile exports, or other unrelated paths.

## Spatial/data assumptions

- Basemap style data is vector context with provider-owned source/licensing and existing attribution; no new dataset is persisted.
- Operational points remain WGS84 longitude/latitude coordinates already used by `LocationPoint`; no coordinate transform or derived distance calculation is introduced.
- Route truth, provider/fallback metadata, and operational POI context remain separate evidence and data concerns.

## Acceptance criteria

1. Users can toggle `อาคาร`, `สถานที่/POI`, and `จุดส่ง/คลัง` without a page error; the active state is visible and accessible through `aria-pressed`.
2. Building/place/POI toggles change matching basemap layer visibility; they do not alter routes, locations, optimizer results, or provider metadata.
3. Operational points still cluster below the existing individual-marker threshold, restore at high zoom, and keep depot/selection behavior intact.
4. Provenance is clear: basemap context is labelled as map context; operational points are labelled as master-data points; no unverified entrance/access claim is shown.
5. Desktop and 390x844 mobile browser E2E cover initial state, toggle round-trip, zoom in/out, operational-point hide/show, no horizontal overflow, and console error/warn absence.
6. Focused lint/build/diff checks pass, self-audit finds no blocker/major issue, approved staged diff is reconciled, and commit/push succeeds.

## Verification and evidence

- Source/diff: inspect candidate status, targeted source diff, and `git diff --check`.
- Focused checks: `npm --prefix frontend run lint`; `npm --prefix frontend run build`; backend `python -m py_compile backend\app\main.py` only as a regression check for the existing related dirty backend change.
- Runtime/browser: local frontend/backend, browser-rendered desktop and 390x844 mobile, context toggles, zoom/cluster round-trip, screenshots, console logs.
- Data/spatial: verify no new persisted POI/building dataset or coordinate transformation; preserve original `data/studio-sync.json`.
- Audit: fresh-context sequential `self-audit` plus user-facing copy and UX/visual review evidence. Independent Luna Audit is unavailable in this runtime and must not be claimed.
- Release: stage only approved paths/hunks, commit, verify commit, push `main` to `origin`; no deploy.

## Definition of Done

Implementation, focused checks, browser E2E, copy/visual self-audit, candidate/diff reconciliation, commit, push, and closeout are complete. Any provider, production, device-native, 3D, or external POI enrichment limitation is explicitly recorded as NOT RUN/DEFERRED.

## Rollback

Revert the release commit or restore only the approved source/artifact paths. Do not revert unrelated dirty files or delete user data.

## Scope expansion: pre-existing related VRP release

- OLD SCOPE: map context controls and their evidence only; earlier route-truth and planner-usability edits remained uncommitted in the same checkout.
- NEW SCOPE: include the already-existing related VRP source changes in the release commit: `backend/app/main.py`, `frontend/src/app/page.tsx`, `frontend/src/types/vrp.ts`, `frontend/src/components/vrp-map.tsx`, `CLAUDE.md`, `PROJECT_MEMORY.md`, and the selected route-truth/map handoff artifacts.
- WHY: the user explicitly requested that all outstanding VRP work be completed, committed, and pushed; these files serve the same map-truth/planner-usability objective and no unrelated UI, data, profile, or generated paths are included.
- IMPACT/RISK: the candidate is broader than the map-context delta, so backend syntax, frontend lint/build, runtime health, data preservation, and staged-file reconciliation remain release gates. No deployment is included.
- ROLLBACK: revert the single release commit; leave excluded dirty paths untouched.
- APPROVED FILES: `backend/app/main.py`, `frontend/src/app/page.tsx`, `frontend/src/components/vrp-map.tsx`, `frontend/src/types/vrp.ts`, `CLAUDE.md`, `PROJECT_MEMORY.md`, `artifacts/vrp-map-context-*.md`, `artifacts/vrp-map-truth-*.md`, and `artifacts/vrp-marker-clustering-*.md`.
