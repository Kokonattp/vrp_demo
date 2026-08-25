# VRP MapLibre cluster-click E2E evidence

Date: 2026-08-25
Candidate: `vrp-cluster-click-20260825-c`
Target: local frontend `http://127.0.0.1:3000/` + backend `http://127.0.0.1:8000/`; production frontend `https://vrp-demo.vercel.app/`
Browser evidence: Codex in-app browser, rendered page; no authenticated/provider/device claim.

## Desktop rendered E2E

- Initial state: zoom `11.50`, density `clustered`, MapLibre cluster layers ready, rendered cluster count `3`, viewport width/scroll width `1280`.
- Circle-coordinate click at the visible cluster target: state `expanded`, zoom `11.50 -> 12.25`.
- Accessible count-label target: `aria-label=ขยาย cluster 2 จุด`; click state `expanded`, zoom `11.50 -> 12.25`.
- Double-click probe: state remained `expanded`, no duplicate expansion error.
- Zoom in twice after expansion: zoom `14.25`, density `individual`, visible HTML markers `63`.
- Browser console error/warn: none.

## Production rendered smoke after Vercel deploy

- Deployment: PASS — Vercel deployment `dpl_8FF45akC2yXA39UR4ejTWQt1aQkM`, state `READY`, alias `https://vrp-demo.vercel.app`.
- Desktop: initial native cluster targets rendered; count-label click reached `ขยาย cluster แล้ว`; no expansion error.
- Mobile 390x844: one accessible cluster target rendered; count-label click reached `ขยาย cluster แล้ว`; `innerWidth=390`, `scrollWidth=390`, `bodyScrollWidth=390`.
- Production browser console error/warn: none.
- Production page response: PASS — HTTP 200.
- Production frontend `/api/health`: PASS — HTTP 200, `status=ok`, configured `mapbox/driving-traffic`, `routingApi=true`, `trafficAware=true`, `ortools=true`.

## Mobile rendered E2E at 390x844

- Fresh state: width `390`, document/body scroll width `390`, zoom `11.50`, cluster layers ready, rendered cluster count `1`.
- Zoom out three steps to a dense view: zoom `8.50`, rendered clusters `3`, accessible target `ขยาย cluster 3 จุด`.
- Accessible cluster click: state `expanded`, zoom `8.50 -> 9.25`.
- Zoom in five steps: zoom `14.25`, density `individual`.
- Zoom out five steps: zoom `9.25`, density `clustered`.
- Final overflow check: `innerWidth=390`, `scrollWidth=390`, `bodyScrollWidth=390`.
- Browser console error/warn: none.

## Runtime/data checks

- Local `/health`: PASS — `status=ok`, routing provider `osrm`, `routingApi=true`, `trafficAware=false`, `ortools=false`.
- Local frontend `/api/health`: PASS — `status=ok`.
- `data/studio-sync.json` preserved: `updatedAt=2026-08-25T01:53:18.909Z`, planning date `2026-05-19`, saved plans `0`, locations `63`.
- Runtime-generated `backend/data/studio-sync.json` was moved to the Windows Recycle Bin after testing; ports 3000/8000 were closed.
- Backend production health: BLOCKED — `https://nattp-vrp-demo-api.hf.space/health` returns HTTP 404/Hugging Face not-found page after the subtree push; do not treat the backend push as reachable production health.
- Provider-authenticated, device-native, authenticated-owner, and 3D building E2E: NOT RUN.
