# VRP Map Truth and Planner Usability Hardening

## Identity

- Task ID: VRP-MAP-TRUTH-2026-08-25
- Objective: Make route truth explicit and keep the active Route Plan scope consistent across the sidebar, map lines, markers, bounds, traffic overlays, and runtime provider state.
- Decision owner: Workspace owner
- Risk level: medium; public-facing planning behavior and backend response contract, but no production change in this package
- Repository and starting revision: `D:\VRP`, `fcb0c80dab3e4c73e540452fc68338ab230d739d`

## Current state

- The frontend computes `filteredRoutes` for the Route Plan sidebar but passes `result.routes` to the map.
- The map fits bounds from all master locations, including locations outside the selected route/cluster.
- Backend route objects expose geometry but not whether it came from a real provider or a simulated fallback.
- Backend health exposes provider/traffic/OR-Tools flags, but the frontend does not distinguish the configured provider from the provider actually used for each result.
- Optimizer currently hard-codes all vehicle starts/ends to node `0`; location restrictions and vehicle start/end IDs are accepted but not enforced.
- The existing checkout contains unrelated uncommitted user changes in `frontend/src/app/layout.tsx`, `frontend/next-env.d.ts`, `CLAUDE.md`, `PROJECT_MEMORY.md`, `data/`, and `artifacts/`; preserve them.
- Project instructions read: `CLAUDE.md`, `PROJECT_MEMORY.md`, and `PROJECT_HANDOFF.md`.

## Scope

### In scope

- Add explicit route metadata for matrix source, geometry source, traffic state, fallback reason, and computation time.
- Return runtime provider state from `/health` and preserve it through optimize/manual-route responses.
- Make map routes and bounds follow the active Route Plan filter and selected Cluster/route scope.
- Add map controls for fitting the active scope, all locations, and resetting the scope.
- Distinguish provider geometry from simulated straight-line geometry in the map and user-facing route status.
- Add preflight feasibility checks for missing locations, service date, service area/zone mismatches, vehicle restrictions, capacity, stops, and unsupported vehicle start/end locations; surface actionable unassigned reasons.
- Add focused verification artifacts without adding a new dependency or external integration.

### Out of scope

- MiroFish, WMS, proof of delivery, authentication/authorization, PostgreSQL persistence, production deploy, Git push, provider credential changes, migrations, and advanced pickup/delivery or stochastic optimization.
- Rewriting unrelated user changes or generated assets.

### Allowed write set

- `frontend/src/app/page.tsx`
- `frontend/src/components/vrp-map.tsx`
- `frontend/src/types/vrp.ts`
- `backend/app/main.py`
- `artifacts/vrp-map-truth-task-contract.md`
- `artifacts/vrp-map-truth-plan-closeout.md`

### Forbidden actions

- Do not push, deploy, change provider credentials, delete data, reset/checkout files, or alter unrelated working-tree paths.
- Do not claim provider, browser, device, or production readiness from source/check/build evidence.

## Assumptions and risks

- Existing API clients can tolerate additive response fields.
- Legacy saved plans may not contain new metadata; frontend must use safe defaults and label unknown state rather than inventing provider truth.
- Provider calls may fail or be unavailable; fallback must remain usable but visibly approximate.
- A full multi-depot implementation is not assumed; unsupported non-depot starts/ends must be reported before optimization rather than silently ignored.

## Acceptance criteria

1. The active route filter/selected scope controls the route lines, route markers, and map bounds shown to the user.
2. The map provides `Fit selected`, `Fit all`, and reset behavior without losing the current selected location.
3. Every route result identifies matrix/geometry source and traffic state; simulated geometry is visually and semantically distinct from provider geometry.
4. Provider failure includes an actionable reason and cannot silently appear as confirmed road truth.
5. Feasibility checks identify invalid date/location/zone/restriction/capacity/start-end cases before optimization and provide actionable unassigned reasons.
6. Focused source checks, frontend lint/build, backend parse/runtime smoke, and a fresh self-audit are recorded separately.

## Definition of Done

- Approved files only are changed and unrelated changes remain untouched.
- Focused verification and relevant project commands pass, or each missing gate is recorded as `NOT RUN`.
- UI copy audit is completed for changed visible states; rendered browser evidence remains separate and is not inferred from source/build.
- Plan closeout records candidate, diff, checks, risks, unverified items, and exact next action.

## Verification and evidence

- Source/diff: `git status --short`, `git diff --check`, changed-file review.
- Focused code: backend `python -m py_compile backend\\app\\main.py`; route truth/preflight smoke using the available Python runtime; TypeScript through frontend lint/build.
- Runtime: local backend health/optimize smoke if dependencies are available; browser-rendered review is required for UI closure and will be `NOT RUN` if no supported browser/runtime is available.
- Release: no deploy/push in this package.

## Rollback

- Revert only the approved changed paths/hunks after inspecting the diff; never reset the checkout because unrelated user changes are present.

## Execution

- Formation: main agent sequential implementation plus fresh-context `self-audit`; no callable independent subagent was dispatched.
- Isolation: sequential primary checkout exception due to pre-existing uncommitted user context.
- Budget: one implementation round, at most one audit/fix loop, focused checks only, no external side effects.
