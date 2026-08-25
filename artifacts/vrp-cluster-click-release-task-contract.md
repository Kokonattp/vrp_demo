# VRP MapLibre cluster-click release task contract

Status: `SOL GATE: READY`
Date: 2026-08-25
Candidate: `vrp-cluster-click-20260825-c`
Base revision: `6851b0856c67822cdf9dbdc5bd286c7116c194c5`
Checkout: `D:\VRP` (sequential exception; unrelated dirty paths remain preserved)

## Objective

Make the existing MapLibre native delivery-point cluster interaction reliable and verifiable: clicking either the cluster circle or its count label must expand the cluster toward the target zoom, show a user-visible interaction state, avoid duplicate async expansion, and fail without an unhandled browser error. Then run candidate-bound rendered E2E, audit, commit, push, and deploy the documented frontend/backend targets.

## Current behavior and context

- `frontend/src/components/vrp-map.tsx` uses `maplibre-gl` GeoJSON clustering for store locations.
- The click handler currently listens only on the cluster circle layer and does not expose an interaction state or catch expansion errors.
- The count label is a separate symbol layer, so a click on the visible count text may not consistently reach the circle-layer listener.
- Frontend is a Next.js app in `frontend/`; backend is FastAPI in `backend/`.
- `PROJECT_HANDOFF.md` documents frontend deployment through the existing Vercel/GitHub path and backend deployment to the Hugging Face Space remote `hf` at `nattp/vrp-demo-api`.

Implementation now uses a 64px native cluster radius, map-wide MapLibre click hit testing, an accessible HTML cluster hit target above map controls, and load/idle/styledata/retry lifecycle setup. The native GeoJSON source and `getClusterExpansionZoom` remain the source of cluster truth.

## In scope

- Update the MapLibre cluster event handling and small user-facing status copy in `frontend/src/components/vrp-map.tsx`.
- Cover both `location-cluster-circles` and `location-cluster-count` click targets, pointer cursor behavior, async error handling, and duplicate-click protection.
- Add or update candidate contract, E2E, self-audit, and plan-closeout evidence artifacts.
- Run focused lint/build/backend syntax checks and local rendered desktop/mobile E2E.
- Commit and push the approved source/evidence paths to `origin/main`.
- Deploy the validated backend through the documented `hf` subtree push and deploy the frontend through the actual configured Vercel path if authenticated and resolvable; verify each deployed target separately.

## Out of scope / forbidden

- Replacing MapLibre, changing basemap providers, rewriting route optimization, changing coordinate systems, adding external POI/building data, changing auth/secrets, migrations, or production environment variables.
- Staging unrelated dirty paths such as `frontend/src/app/layout.tsx`, `frontend/src/app/opengraph-image.tsx`, `data/`, generated screenshots, or browser profile exports.
- Claiming frontend production deployment if no authenticated/resolved Vercel project or deployment URL can be verified; in that case record `DEPLOY: BLOCKED/NOT RUN` and do not silently substitute another host.

## Acceptance criteria

1. At clustered zoom, clicking the circle expands the map toward the cluster expansion zoom.
2. Clicking the visible count label also expands the same cluster; repeated click events do not start duplicate expansion promises.
3. Expansion errors are handled without an unhandled browser console error, and the UI exposes a recoverable status.
4. At high zoom, individual markers remain readable; zoom-out returns to clustered state; route lines, depot marker, context toggles, and operational data remain unchanged.
5. Desktop and 390x844 mobile browser E2E cover both click targets, zoom/state round-trip, no overflow, and console error/warn absence.
6. Focused checks, self-audit, staged diff reconciliation, commit/push, backend deployment verification, and frontend deployment verification pass, or any unavailable release gate is explicitly reported as `NOT RUN`/`BLOCKED`.

## Verification and evidence

- Source/diff: candidate status, targeted source diff, `git diff --check`, staged path manifest.
- Focused: `npm --prefix frontend run lint`, `npm --prefix frontend run build`, `python -m py_compile backend\app\main.py`.
- Runtime/browser: local frontend/backend, MapLibre rendered desktop and 390x844 mobile, click circle, click count label, zoom state, browser console.
- Data/security: preserve `data/studio-sync.json`; no new credentials or persisted spatial data; generated runtime sync file cleaned recoverably.
- Deploy: backend `/health` on Hugging Face; frontend deployed URL and `/api/health`/page evidence through the verified Vercel target. No provider/production claim without a reachable URL and observed response.
- Audit: sequential fresh-context `self-audit`; independent Luna Audit is unavailable and must not be claimed.

## Definition of Done

The cluster circle and count-label click paths are candidate-bound E2E verified, focused checks and audit pass, only approved paths are committed and pushed, backend and frontend deployment status is separately verified, closeout is written, and remaining unverified gates are visible.

## Rollback

Revert the release commit. If backend deployment has been updated, redeploy the previous backend subtree revision; do not reset or delete unrelated working-tree files.

## Scope expansion: Vercel upload boundary

- Old scope: deploy the linked Vercel project from the repository root using the existing project link.
- New scope: add root `.vercelignore` so the deployment upload excludes repository history, local deployment metadata, backend/data/artifacts, and generated frontend dependencies/build output.
- Why: the first root deploy attempt selected a 173 MB upload because the repository contains local evidence and generated files; it was stopped before promotion.
- Impact/risk: deployment input is narrower and does not change application source; the ignored paths remain in the working tree and are not staged by this task. Rollback is to remove `.vercelignore` and use the prior deployment boundary.
