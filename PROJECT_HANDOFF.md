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
Cluster + support vehicle
```

Business logic:

```text
1 Cluster tries to use 1 Primary vehicle first.
If Weight / CBM / Stops / Time window does not fit, add only necessary Support vehicle(s).
Global optimize is kept as a simulation / benchmark mode.
```

Optimization modes in UI:
- `Cluster + support vehicle`
- `Strict 1 vehicle / cluster`
- `Global optimize`

Recommended explanation:
- Pure VRP = optimizer decides everything globally.
- Cluster-first VRP = planner defines business route templates first, then VRP optimizes inside that frame.
- For logistics operations with recurring rounds, Cluster-first VRP is the recommended default.

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
Branch data -> Cluster -> Vehicle -> Order / Optimize
```

Implemented UI:
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
  - `Route plan`
  - current optimize mode
  - `Cluster readiness`
  - route summary
  - print work order
  - QR driver

Wording preference:
- User prefers Thai, but use English/transliterated terms when clearer:
  - Branch
  - Cluster
  - Vehicle
  - Order
  - Optimize
  - Capacity
  - Time window
  - Support vehicle
  - Primary vehicle

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

Backend Hugging Face Space was last pushed with cluster schema:

```text
9eb8a8e
```

## Deployment Notes
Frontend changes are pushed to GitHub `main`.

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

