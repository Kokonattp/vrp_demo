# VRP Map Truth / Planner Usability — Plan Closeout

Status: CLOSED_WITH_NOTES
Handoff: PLAN_CLOSED
Date: 2026-08-25

## Objective and outcome

Harden the VRP planner so the map follows the active route scope, route geometry and matrix provenance are visible, fallback output is distinguishable, infeasible orders have actionable reasons, and the first-run/mobile layout remains usable.

Implemented in the bounded write set. No deploy, push, migration, credential change, or production data change was performed.

## Files changed

- `frontend/src/app/page.tsx` — route truth/fallback copy, filtered map scope, unassigned reasons, local fallback constraints, mobile flow layout.
- `frontend/src/components/vrp-map.tsx` — scoped/all fit controls, provider geometry traffic legs, simulated geometry styling, Thai-first map controls.
- `frontend/src/types/vrp.ts` — matrix/geometry source, traffic, fallback, timestamp, and unassigned-reason fields.
- `backend/app/main.py` — health/runtime provenance, matrix/geometry metadata, preflight feasibility, vehicle restrictions, max-stop constraints, unassigned reasons, and Thai fallback explanations.
- `artifacts/vrp-map-truth-task-contract.md` — task contract used for this plan.

Unrelated existing changes were preserved: `frontend/src/app/layout.tsx`, `frontend/next-env.d.ts`, `CLAUDE.md`, `PROJECT_MEMORY.md`, `data/`, `frontend/src/app/opengraph-image.tsx`, and pre-existing artifact contents.

The browser smoke exercised the app's normal local autosave; it only advanced the pre-existing sync timestamp, so the original timestamp was restored and no state/route data was intentionally changed.

## Verification evidence

- Source/diff: PASS — intended implementation files only; `git diff --check` returned no errors (only existing LF/CRLF warnings).
- Frontend lint: PASS — `npm --prefix frontend run lint`.
- Frontend build/typecheck: PASS — `npm --prefix frontend run build`; routes generated successfully.
- Backend syntax: PASS — `python -m py_compile backend\\app\\main.py`.
- Backend runtime smoke: PASS — local FastAPI `TestClient` returned `/health` with OSRM/routing API connected, `/api/optimize` returned a fallback route with `matrixSource=osrm`, `geometrySource=osrm`, `trafficAware=false`, timestamp, and a visible fallback reason; invalid vehicle start/end returned `infeasible` with unassigned reasons.
- Constraint smoke: PASS — isolated local runtime checks confirmed restricted orders go to an allowed vehicle and max-stop overflow is reported as unassigned with a reason. The OR-Tools branch was source-checked but not runtime-exercised because this environment reports `ortools=false`.
- Browser-rendered smoke: PASS — local Next.js app plus local FastAPI at `http://127.0.0.1:3000/` and `http://127.0.0.1:8000`; desktop rendered map scope/fit controls and Connected OSRM state; 390x844 rendered the map first with the workflow and panels below, no horizontal overflow, and no overlap. A fresh browser tab had no console warnings/errors. The route truth card itself was NOT RUN in the browser because the persisted demo state has 62 orders whose date does not match the preferred Mon/Wed/Fri schedule; backend/source evidence covers that state.
- Copy audit: PASS for the rendered changed states and source-reviewed route card — route source/fallback wording, unassigned reasons, and map controls expose consequence/recovery in Thai-first wording. Technical provider names remain where provenance is useful.

## Decisions and risks

- A route is green only when road geometry is from Google, Mapbox, or OSRM; simulated/unknown geometry is amber and dashed.
- Provider and solver fallback are explicitly reported; local runtime evidence is not treated as production/provider E2E evidence.
- Preflight rejects missing locations, date/preferred-day mismatch, unsupported vehicle restrictions, capacity failure, invalid depot start/end, and zero-stop vehicles. Solver and local fallback also respect preferred days, allowed vehicles, and max stops.
- `serviceFrequency` remains descriptive because enforcing it requires historical service-plan context not present in this request.
- The persisted demo state currently contains orders dated `2026-05-19` while the sample preferred days are Mon/Wed/Fri; the UI now surfaces the date mismatch per order instead of drawing a misleading route. The persisted data was not rewritten.

## Unverified / deferred

- Production deployment, production `/api/health`, authenticated E2E, device-native checks, Google/Mapbox live traffic, OR-Tools runtime branch, print/PDF, and MiroFish are NOT RUN.
- No commit/push/deploy was made. Resume only with an explicit release/provider/device verification plan.

## Next action

Owner may review the changed files, then run the approved production/provider/device gates separately before any release decision.
