# VRP map context self-audit

Date: 2026-08-25  
Candidate: `vrp-map-context-20260825-a`  
Audit mode: sequential fresh-context `self-audit`; an independent Luna Audit runtime was unavailable and is not claimed.

## Result

`PASS_WITH_NOTES` for the approved map-context scope. No P0/P1 blocker was found. The candidate remains suitable for the requested commit/push after the final staged-diff gate.

## Source and data audit

- `frontend/src/components/vrp-map.tsx` keeps CARTO building/place/POI layers as basemap context and controls their visibility by matching the current style's `source-layer`/layer IDs.
- Operational delivery/depot points still come from `locations`; the `จุดส่ง/คลัง` control only changes marker visibility and native cluster visibility. It does not change route geometry, route metadata, optimizer inputs, or the selected scope.
- Access overlays are created only from explicit `LocationPoint.vehicleRestriction` values. No entrance, loading bay, POI, or access restriction is inferred from a footprint or label.
- Popup values used in the new access/context display are escaped before insertion into HTML.
- No new POI/building dataset, coordinate transform, authentication, credential, provider configuration, or backend API was added for this feature.
- `data/studio-sync.json` was preserved: `updatedAt=2026-08-25T01:53:18.909Z`, planning date `2026-05-19`, saved plans `0`. The locally generated `backend/data/studio-sync.json` was removed via the Windows Recycle Bin after runtime testing and is absent.

## Focused verification

- `npm --prefix frontend run lint`: PASS.
- `npm --prefix frontend run build`: PASS; TypeScript and all generated routes completed.
- `python -m py_compile backend\app\main.py`: PASS.
- `git diff --check`: PASS; only Git's LF-to-CRLF normalization warnings were emitted.
- Local `/health`: PASS during E2E (`status=ok`, routing provider `osrm`, `routingApi=true`, `trafficAware=false`, `ortools=false`).
- Ports 3000 and 8000: closed after testing.

## Copy audit

- KEEP: `บริบท`, `อาคาร`, `สถานที่/POI`, `จุดส่ง/คลัง`, and `ข้อจำกัดรถ`; each communicates a user-visible map decision.
- KEEP: disabled `ข้อจำกัดรถ` state with `ยังไม่มีข้อมูลข้อจำกัดรถ` and an explanatory title; it tells the user why the action is unavailable.
- REWRITE APPLIED: the popup's internal `master data` wording was replaced with `ข้อมูลสาขาของโครงการ` / `ข้อมูลของโครงการ`.
- No remaining internal `master data` phrase exists in the affected map UI source.

## Rendered UX/visual audit

- Desktop rendered E2E showed building footprints and POI context at high zoom, removed those context layers while roads remained, and preserved the operational marker control.
- 390x844 rendered E2E showed no horizontal overflow (`innerWidth=390`, `scrollWidth=390`, `bodyScrollWidth=390`) in initial, hidden, and restored states.
- Controls expose `aria-pressed`; the status badges expose zoom/density and context state for assistive/runtime inspection.
- Desktop context round-trip: PASS. Mobile context hide/show and zoom round-trip: PASS. Browser console errors/warnings: none in both runs.
- Keyboard-only traversal, screen-reader output, 768/1024 intermediate widths, native mobile device, authenticated/provider, production, and 3D-building verification: NOT RUN / outside this candidate's release scope.

## Notes and residual risk

- A stable native cluster canvas target was not available for a second click assertion in the latest context-controls run, so current-candidate cluster-click is `NOT RUN`. The cluster handler is unchanged from the earlier marker-clustering package, whose browser evidence records a successful expansion click; the current candidate still proves clustered/individual zoom round-trip.
- The context toggle relies on the currently inspected CARTO style layer naming/source-layer schema. If the remote style changes, the control may need a matching update; provider style drift is an operational risk, not a new persisted data dependency.
- This is source/focused-check/browser-rendered evidence, not provider, device-native, authenticated, production, or 3D proof.

## Audit decision

Proceed to final-strict candidate freeze, explicit staging, commit, push, and plan closeout. Do not stage `frontend/src/app/layout.tsx`, `frontend/src/app/opengraph-image.tsx`, `data/`, Chrome profile exports, old visual artifacts, or other unrelated dirty paths.
