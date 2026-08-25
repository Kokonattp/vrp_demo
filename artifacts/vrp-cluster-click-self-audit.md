# VRP MapLibre cluster-click self-audit

Date: 2026-08-25
Candidate: `vrp-cluster-click-20260825-c`
Audit mode: sequential fresh-context `self-audit`; no independent Luna Audit runtime was available.

## Result

`PASS_WITH_NOTES`; no P0/P1 blocker found for the approved cluster-click scope.

## Source/behavior audit

- MapLibre remains the map engine and native GeoJSON source remains the clustering truth.
- `clusterRadius=64` makes a usable cluster target in the active demo view without changing route data or optimization.
- Cluster setup is resilient to style lifecycle timing: `load`, `idle`, `styledata`, and a short retry interval are covered; cleanup removes listeners and the retry timer.
- Map-wide click hit testing queries both native circle and count layers. The async expansion is guarded against duplicate clicks, catches rejected expansion promises, checks that the map is still current, and sets a user-visible state.
- Accessible HTML hit targets are derived from rendered native cluster features and call the same `getClusterExpansionZoom` path. They are removed/reconciled on move/idle and when operational points are hidden.
- Cluster values and labels are not user-supplied HTML. The new button uses DOM text/attributes; existing popup values remain escaped.
- No route geometry, optimizer input, provider credential, coordinate system, persisted POI/building data, or authentication behavior changed.

## Focused checks

- `npm --prefix frontend run lint`: PASS.
- `npm --prefix frontend run build`: PASS; TypeScript and generated routes completed.
- `python -m py_compile backend\app\main.py`: PASS.
- `git diff --check`: PASS; only LF/CRLF normalization warnings.
- Temporary development diagnostic hook: absent.

## Copy/accessibility audit

- KEEP: `คลิกวงกลมหรือตัวเลข cluster เพื่อขยาย`, `กำลังขยาย cluster`, `ขยาย cluster แล้ว`, and the recoverable error text.
- REQUIRED DISCLOSURE: `aria-label=ขยาย cluster N จุด` gives the count and action for the accessible hit target.
- REWRITE APPLIED: MapLibre's generic `Map marker` aria label was overwritten after marker creation with the actionable Thai label.
- Keyboard-only traversal and screen-reader output: NOT RUN; role-based click and DOM label verification passed.

## UX/visual audit

- Desktop screenshot showed native cluster circles/counts and the matching accessible target; desktop click expanded toward the cluster.
- Mobile 390x844 stayed within viewport width in initial, clustered, expanded, high-zoom, and final states.
- Hit targets deliberately render above the map control overlay so a cluster cannot become visually or interactively trapped beneath the context controls. This can visually overlap a control in an unusually dense view and should be reviewed again if the control layout changes.

## Release notes

- Deployment targets are separate: frontend Vercel project `vrp-demo`; backend Hugging Face Space `nattp/vrp-demo-api` through the `hf` remote. Deployment evidence must be recorded separately from this local E2E.
- Provider traffic-aware routing, authenticated owner flows, native-device behavior, production regression, and 3D building data remain separate gates.
