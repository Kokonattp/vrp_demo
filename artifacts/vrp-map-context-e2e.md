# VRP map context E2E evidence

Date: 2026-08-25
Candidate: `vrp-map-context-20260825-a`
Target: local frontend `http://127.0.0.1:3000/` and local backend `http://127.0.0.1:8000/`

## Source/context evidence

- The CARTO Positron style was inspected from its source URL. It contains vector building layers (`building`, `building-top`), place-label layers backed by `place`, and POI layers backed by `poi`.
- The implementation treats those layers as basemap context. Project operational points remain the active `locations` data and are not replaced by basemap POIs.
- Access-constraint data is derived only from explicit `LocationPoint.vehicleRestriction` values. The current dataset has zero such values, so the UI reports `ยังไม่มีข้อมูลข้อจำกัดรถ` and disables that toggle.

## Desktop rendered E2E

- Initial state: zoom `11.50`, marker density `clustered`, visible HTML markers `1` (depot), context `อาคาร เปิด · สถานที่ เปิด · จุดส่ง เปิด`.
- Toggle buildings and places/POI off: `aria-pressed=false` for both, operational points remained on, visible HTML markers remained `1`, and the rendered screenshot showed the building footprint/POI context removed while streets remained.
- Restore buildings and places/POI, then zoom in five steps: zoom `15.50`, density `individual`, visible HTML markers `63` (62 stores + depot). The rendered screenshot showed building footprints from the basemap.
- Access status: `ยังไม่มีข้อมูลข้อจำกัดรถ`; access toggle disabled as expected.
- Browser console error/warn: none.

## Mobile rendered E2E at 390x844

- Initial state: clustered, visible HTML markers `1`, all context toggles on, access toggle disabled.
- Toggle buildings, places/POI, and operational points off: density `hidden`, visible HTML markers `0`, context status showed all three off.
- Restore toggles, zoom in three steps: zoom `14.50`, density `individual`, visible HTML markers `63`.
- Zoom out three steps: zoom `11.50`, density `clustered`, visible HTML markers `1`.
- Initial, hidden, and round-trip states measured `innerWidth=390`, `scrollWidth=390`, `bodyScrollWidth=390`.
- Browser console error/warn: none.

## Runtime and data checks

- Local `/health`: PASS — `status=ok`, routing provider `osrm`, `routingApi=true`, `trafficAware=false`, `ortools=false`.
- `data/studio-sync.json` remained unchanged: `updatedAt=2026-08-25T01:53:18.909Z`, planning date `2026-05-19`, saved plans `0`.
- Local frontend/backend processes were stopped after the run. Generated `backend/data/studio-sync.json` was moved to the Windows Recycle Bin.
- Provider, authenticated, device-native, production, deployment, and 3D building E2E: NOT RUN / out of scope.
