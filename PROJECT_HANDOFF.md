# VRP Simulation Studio Handoff

## Project
- Workspace: `D:\VRP`
- GitHub: `https://github.com/Kokonattp/vrp_demo.git`
- Frontend: Next.js app in `frontend/`
- Backend: FastAPI app in `backend/`
- Backend deploy: Hugging Face Space `https://huggingface.co/spaces/nattp/vrp-demo-api`
- Backend health URL: `https://nattp-vrp-demo-api.hf.space/health`

## Product Direction
The system is still VRP, but the default planning flow is now **Cluster-first VRP**.

Default optimization mode:

```text
Cluster + route-fill
```

Business logic:

```text
1 Cluster tries to use 1 Primary vehicle first.
If the vehicle still has Weight / CBM / Stops capacity and no fixed time / locked cluster / vehicle restriction blocks the stop, add flexible stores along the way to that cluster.
If the cluster and route-fill demand does not fit, add only necessary Support vehicle(s).
Each numbered Cluster is assigned to the matching numbered Vehicle as its primary route template.
Global optimize was removed from the user-facing demo flow.
```

Optimization modes in UI:
- `Cluster + route-fill`
- `Strict 1 vehicle / cluster`

Recommended explanation:
- Pure VRP = optimizer decides everything globally.
- Cluster-first VRP = planner defines business route templates first, then VRP optimizes inside that frame.
- Route-fill = if a vehicle is going to Cluster A and still has capacity, the planner may add flexible stores that are on the way before running VRP for that route.
- For logistics operations with recurring rounds, Cluster-first VRP is the recommended default.
- In the demo, Vehicle 1 is the primary vehicle for Cluster 1, Vehicle 2 for Cluster 2, and so on.

## Traffic / Routing
Backend is configured to support Mapbox traffic-aware routing.

Required backend env:

```env
ROUTING_PROVIDER=mapbox
MAPBOX_ACCESS_TOKEN=pk...
MAPBOX_PROFILE=mapbox/driving-traffic
MAPBOX_TRAFFIC_BUCKETS=07:30,08:30,09:30,11:00,13:00,15:00,17:00,18:30
MAPBOX_TRAFFIC_TIMEZONE_OFFSET=+07:00
MAPBOX_MATRIX_BATCH_SIZE=0
OSRM_BASE_URL=https://router.project-osrm.org
FRONTEND_ORIGINS=https://your-frontend-domain.vercel.app
STUDIO_SYNC_FILE=/data/studio-sync.json
```

Expected health response should include:

```json
{
  "routingProvider": "mapbox",
  "trafficAware": true,
  "ortools": true
}
```

Notes:
- Mapbox Matrix `mapbox/driving-traffic` is limited per request, but backend now batches Matrix calls and recombines the full matrix.
- Matrix usage scales by `points x points x traffic buckets`.
- Route geometry uses Mapbox first, then OSRM/simulated fallback where needed.

## Current UX
Main workflow:

```text
ข้อมูลสาขา -> Cluster -> Vehicle -> Order / Optimize
```

Implemented UI:
- Page title is now `VRP Simulation Studio`.
- Branch-facing labels in the main UI were changed to Thai `สาขา / ข้อมูลสาขา`.
- Use English for technical terms when Thai sounds awkward:
  - Vehicle
  - Order
  - Cluster
  - Optimize
  - Capacity
  - constraints
  - Demo Cost Model
  - Route Plan
- Import CSV and branch editor are merged into one `ข้อมูลสาขา` panel.
- `Import daily orders` was added for day-by-day demand files:
  - uses the existing branch / Cluster master
  - imports only Order rows by `locationId`
  - does not overwrite branch coordinates or `clusterId`
  - replaces orders for the imported service date(s)
- Branch master import does not require `clusterId`.
- `Generate clusters` is the intended first-run / monthly planning action:
  - starts from branch coordinates and the selected planning date
  - writes `clusterId` back into the in-browser branch master
  - preserves manually locked branches
  - users can edit `clusterId` and `Lock cluster` after generation
- The current demo syncs branch / Cluster / order edits and saved route plans through `/api/studio-sync`.
- Browser local storage remains a fallback cache only. For cross-device updates, the backend must use a persistent `STUDIO_SYNC_FILE`, for example `/data/studio-sync.json` on Hugging Face Spaces with Persistent Storage enabled.
- The old `ใช้ template ของวันที่เลือก` button was removed.
- Branch / Vehicle / Order / Cost model edit via modal dialogs.
- Cluster tab has dashboard cards.
- Cluster tab has `Capacity check`.
- Capacity check shows progress bars:
  - Weight
  - CBM
  - Stops
- Cluster cards show status:
  - `Fit`
  - `Support`
  - `Over`
- Map marker colors follow cluster before route optimization.
- Map has `Cluster legend`.
- Right panel shows:
  - `Route Plan`
  - current optimize mode
  - `Cluster Capacity`
  - route filters: all routes, needs attention, late warnings, high capacity usage
  - map traffic controls:
    - `Route` overlays route legs as green / amber / red traffic-impact segments from leg travel time versus distance
    - `City` overlays Mapbox Traffic v1 vector tiles for city-wide congestion when `NEXT_PUBLIC_MAPBOX_TOKEN` is set
  - route timeline with arrival time, drive time, service time, and warnings
  - saved route plans in browser local storage; users can reopen a saved plan with its route result, branches, vehicles, orders, cost model, planning date, and selected Cluster
  - manual stop ordering via drag and drop inside each route card; this locks the edited sequence, calls `/api/route/manual`, and reroutes road geometry/distance/duration through the backend provider
  - undo manual reorder per route
  - route summary
  - `Export PDF` for the current Route Plan filter, plus `Export route PDF` for a single selected route, including route drawing, stop list, per-stop weight / CBM, service time, and warnings
  - print work order
  - QR driver
- When the app is in fallback/offline mode, route lines are preview lines from stop sequence, not true road geometry. Real road geometry requires the backend routing provider to respond.
- Card borders and shadows were strengthened across the app for better readability.

Wording preference:
- User prefers Thai, but use English for technical/product terms when clearer.
- Do not force awkward Thai translations, for example use `VRP Simulation Studio` rather than `สตูดิโอจำลองแผนขนส่ง VRP`.
- Avoid visible `Branch` wording where the user-facing meaning is simply `สาขา`.
- Keep these terms in English unless there is a very natural Thai equivalent:
  - Cluster
  - Vehicle
  - Order
  - Optimize
  - Capacity
  - Time window
  - Support vehicle
  - Primary vehicle
  - constraints
  - Demo Cost Model

## Current Demo Data
Frontend seed data in `frontend/src/lib/sample-data.ts` now includes:

```text
62 stores / delivery points
12 route clusters, usually 3-7 stores per cluster
12 vehicles
62 same-day sample orders, generated from the store seed list
```

Covered regions:
- Bangkok
- Metropolitan area
- Central region
- Eastern region
- Northeastern region

Operational interpretation:
- This is enough for demo usage and Cluster-first route template planning.
- It is enough when running per cluster, or using `Optimize all` to produce route-template style results across 12 primary vehicle routes.
- The demo now avoids a global optimize choice so users stay in the intended Cluster-first planning model.
- If the product needs stricter real daily operations, add a `vehicle assignment by date / delivery round` layer so support vehicles cannot be reused by multiple clusters in the same round.
- Another practical option is to split service by day, such as Mon / Wed / Fri, so each day only runs the clusters due for that round.

## Data Model
Frontend `LocationPoint` supports:

```ts
clusterId?: string;
clusterLocked?: boolean;
preferredDays?: string[];
preferredTimeWindow?: string;
serviceFrequency?: "daily" | "weekly" | "biweekly" | "monthly";
zoneHint?: string;
vehicleRestriction?: string;
```

Backend `LocationPoint` accepts matching optional fields:

```py
clusterId: str | None = None
clusterLocked: bool = False
preferredDays: list[str] = Field(default_factory=list)
preferredTimeWindow: str | None = None
serviceFrequency: Literal["daily", "weekly", "biweekly", "monthly"] | None = None
zoneHint: str | None = None
vehicleRestriction: str | None = None
```

## Important Commits
- `8cc3f64 feat: add Mapbox traffic routing provider`
- `1a417c2 feat: batch Mapbox traffic matrices`
- `5ae37e3 feat: edit VRP data in modal dialogs`
- `81b4235 feat: add cluster-first VRP workflow`
- `09e381a refactor: simplify cluster-first workflow page`
- `a5ea18b feat: prefer primary vehicle per cluster`
- `a571a7a style: polish cluster-first VRP dashboard`
- `8608445 style: merge branch import and editor panel`
- `5ca1fc2 feat: expand sample branch network`
- `b3cf6ec copy: clarify vrp interface wording`

Backend Hugging Face Space was last pushed with cluster schema:

```text
9eb8a8e
```

## Deployment Notes
Frontend changes are pushed to GitHub `main`.

Required frontend env:

```env
HF_API_URL=https://nattp-vrp-demo-api.hf.space
HF_TOKEN=hf_your_read_token_if_space_is_private
NEXT_PUBLIC_API_URL=https://nattp-vrp-demo-api.hf.space
NEXT_PUBLIC_MAPBOX_TOKEN=pk_your_mapbox_public_token
```

Required backend env:

```env
FRONTEND_ORIGINS=https://your-frontend-domain.vercel.app
STUDIO_SYNC_FILE=/data/studio-sync.json
ROUTING_PROVIDER=mapbox
MAPBOX_ACCESS_TOKEN=pk_or_sk_your_mapbox_token
MAPBOX_PROFILE=mapbox/driving-traffic
MAPBOX_TRAFFIC_BUCKETS=07:30,08:30,09:30,11:00,13:00,15:00,17:00,18:30
MAPBOX_TRAFFIC_TIMEZONE_OFFSET=+07:00
MAPBOX_MATRIX_BATCH_SIZE=0
OSRM_BASE_URL=https://router.project-osrm.org
```

For `STUDIO_SYNC_FILE=/data/studio-sync.json`, enable Persistent Storage on the backend host. If `/data` is not persistent, saved plans can disappear on restart/redeploy.

Use `HF_API_URL` and `HF_TOKEN` as server-side frontend env only. `NEXT_PUBLIC_MAPBOX_TOKEN` is intentionally public and only enables the UI city traffic tile layer.

Manual stop reorder now calls `/api/route/manual`, which locks the user-edited stop order and reroutes the geometry/distance/duration through the backend routing provider.

For backend changes, push subtree to Hugging Face:

```powershell
git subtree split --prefix backend main
git push hf <split_hash>:main
```

## Verification Commands
Frontend:

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
```

Backend parse check:

```powershell
python -m py_compile backend\app\main.py
```

## Generated Image
Infographic saved at:

```text
D:\VRP\artifacts\vrp-vs-cluster-first-vrp.png
```

## Git / Workspace Notes
- `artifacts/` contains generated images and is intentionally untracked unless the user asks to commit it.
- User often wants commit/push immediately when implementation is done.
- Be careful not to revert unrelated changes.
