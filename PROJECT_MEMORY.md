# VRP Project Memory

## Product direction

- Product: VRP Simulation Studio for Thai logistics planning.
- The core product is a real route-planning and operations workflow, not only a map demo.
- MiroFish, if added later, is a scenario/what-if layer. It must not replace the deterministic VRP optimizer or road-routing provider.
- Current product direction is Cluster-first VRP: recurring route templates and operational clusters are defined first, then the optimizer fills feasible routes with Primary/Support vehicles.

## Current user problem

- The planner is difficult to use.
- The map is not trusted because route lines, filters, zoom level, and provider/fallback state are not always aligned with what the user is viewing.
- Treat this as a product usability and route-truth problem, not only a visual-polish task.

## Confirmed source findings

- `frontend/src/app/page.tsx` computes `filteredRoutes` for the Route Plan sidebar, but the map is currently passed `result.routes` rather than the filtered route set. Route filters therefore do not fully control the map.
- `frontend/src/components/vrp-map.tsx` auto-fits bounds from all `locations`, including the full master dataset, rather than the selected route/cluster. Large multi-region data can zoom the map out too far.
- The traffic-impact overlay builds straight stop-to-stop segments instead of using provider road geometry.
- `backend/app/main.py` falls back from Google/Mapbox/OSRM to simulated matrices and from road geometry to straight coordinate lines when providers fail. This must be explicitly labelled and must not look like confirmed road routing.
- The model contains fields such as `vehicleRestriction`, `restrictedZones`, `preferredDays`, and `serviceFrequency`; these are not yet proven to be enforced by the optimizer and require focused verification before being treated as hard constraints.
- The main optimizer currently constructs routes from a shared depot index; per-vehicle `startLocationId` and `endLocationId` need verification before claiming multi-depot or different vehicle start/end support.
- The demo dataset spans multiple Thai regions on the same planning date. This can create operationally unrealistic cross-region routes and should be handled by service area/date feasibility gates or a smaller first-run dataset.

## Confirmed map behavior (2026-08-25)

- `frontend/src/components/vrp-map.tsx` uses MapLibre native GeoJSON clustering for store locations in the active map scope; the depot remains an individual HTML marker.
- Below zoom 13, store HTML markers are hidden to prevent pile-up and the map shows native cluster/count layers. At zoom 13 or above, individual store markers return with their existing popup, selection, route numbering, and drag behavior.
- Clicking a cluster calls MapLibre cluster expansion zoom and moves the map toward that cluster. The rendered density status explains whether the map is clustered or showing individual markers.
- Cluster click uses MapLibre `getClusterExpansionZoom` with map-wide hit testing for both the native circle and count layer. Accessible HTML cluster hit targets are positioned above map controls so circle/count expansion remains usable in desktop and mobile layouts. Cluster setup retries across `load`, `idle`, `styledata`, and a short local interval to avoid the MapLibre style-load race observed in responsive E2E.
- `maplibre-gl` remains the required map engine for the current implementation because basemap layer visibility, GeoJSON clustering, rendered feature hit testing, and cluster expansion all use its APIs. Replacing it would be a separate architecture change.
- Browser evidence for desktop and 390px mobile zoom in/out is recorded in `artifacts/vrp-marker-clustering-e2e.md`; this does not prove provider, device-native, or production readiness.
- The map context controls expose CARTO basemap buildings and place/POI labels separately from project operational points. Basemap context is not VRP truth; operational points come from project branch data. Verified building entrances/loading bays are not present and must not be inferred from a basemap footprint or POI label.

## Runtime/evidence boundary

- The intended backend health URL recorded in `PROJECT_HANDOFF.md` returned HTTP 404 during the 2026-08-24 read-only check, although the current source defines `/health`. Treat deployment/source drift as a priority investigation.
- Existing screenshots are static artifacts, not current browser runtime proof.
- Browser-rendered current-flow review, provider E2E, authenticated/device E2E, and production readiness remain unverified.
- Do not claim map or route production readiness from source inspection, screenshots, or fallback output alone.

## Next bounded work package

Map Truth and Planner Usability Hardening, in this order:

1. Restore and verify the deployed backend/runtime contract; `/health` must expose provider, traffic, and optimizer state from the runtime actually used by the frontend.
2. Add route metadata for `matrixSource`, `geometrySource`, `trafficAware`, `fallbackReason`, and `computedAt`.
3. Make map routes follow the active Route Plan filter and selected Cluster/route.
4. Fit bounds to the active visual scope and provide `Fit selected route`, `Fit all`, and reset behavior.
5. Use road geometry for traffic overlays; show an explicit simulated/approximate state when real geometry is unavailable.
6. Add pre-optimization feasibility checks for date, service area, route duration/distance, vehicle restrictions, and unassigned-order reasons.
7. Simplify the first-run planner flow to: date/area -> data validation -> capacity check -> optimize -> review -> driver handoff.
8. Use a small same-area dataset for first-run onboarding; keep the large multi-region dataset as an explicit scenario.

## Acceptance criteria for that package

- A selected route or cluster is the same scope shown in the sidebar, map lines, markers, and map bounds.
- Real road geometry and simulated straight-line geometry are visually and semantically distinct.
- Provider failure is visible with a reason and cannot silently produce a route presented as road-truth.
- Impossible or cross-region plans receive actionable validation before optimization.
- A new Planner can complete import/validation/optimization/route handoff without needing to understand all advanced VRP terms.
- Verification must include source checks, focused optimizer/map tests, current browser-rendered desktop/mobile flows, and runtime/provider evidence as separate gates.

## Deferred

- MiroFish scenario simulation integration.
- Full WMS integration, driver Proof of Delivery, role-based access, and PostgreSQL persistence hardening.
- Advanced optimization such as pickup/delivery, multi-depot, vehicle skills, and robust/stochastic planning until the route-truth and planner workflow are stable.
