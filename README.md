# VRP Simulation Studio

A web studio for planning simulated vehicle routing scenarios on real maps.

## Stack

- Next.js, TypeScript, Tailwind CSS, shadcn-style UI components
- MapLibre GL JS with OpenStreetMap raster tiles
- FastAPI backend
- Python OR-Tools for VRP optimization
- PostgreSQL schema included for persistence-ready deployment

## Run Locally

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open `http://localhost:3000`.

## Deploy

Recommended split:

- Deploy `frontend/` to Vercel.
- Deploy `backend/` to Render, Railway, Fly.io, or a VPS.
- Set `NEXT_PUBLIC_API_URL` in Vercel to the public backend URL.

## Environment Variables

### Frontend

Set these in Vercel, or in `frontend/.env.local` for local testing:

```env
# Preferred when the backend is a Hugging Face Space or any server-side/private API.
HF_API_URL=https://nattp-vrp-demo-api.hf.space

# Required only when the backend is private and needs an HF token.
HF_TOKEN=hf_your_read_token

# Optional public backend fallback. Not needed when HF_API_URL is set.
NEXT_PUBLIC_API_URL=https://nattp-vrp-demo-api.hf.space

# Optional: enables the City traffic layer on the map.
NEXT_PUBLIC_MAPBOX_TOKEN=pk_your_mapbox_public_token
```

### Backend

Set these in the backend deployment environment:

```env
# Required so the frontend can call the backend.
FRONTEND_ORIGINS=https://your-frontend-domain.vercel.app

# Required for shared saved plans across devices.
# On Hugging Face Spaces, enable Persistent Storage and use /data.
STUDIO_SYNC_FILE=/data/studio-sync.json

# Recommended routing provider with traffic-aware travel time.
ROUTING_PROVIDER=mapbox
MAPBOX_ACCESS_TOKEN=pk_or_sk_your_mapbox_token
MAPBOX_PROFILE=mapbox/driving-traffic
MAPBOX_TRAFFIC_BUCKETS=07:30,08:30,09:30,11:00,13:00,15:00,17:00,18:30
MAPBOX_TRAFFIC_TIMEZONE_OFFSET=+07:00
MAPBOX_MATRIX_BATCH_SIZE=0

# Fallback road routing when Mapbox is unavailable.
OSRM_BASE_URL=https://router.project-osrm.org
```

If you do not enable persistent storage for `STUDIO_SYNC_FILE`, saved planner state can disappear after backend restart or redeploy. `localStorage` remains a browser fallback, but it is not enough for cross-device updates.

### Vercel

Create a GitHub repo and import it in Vercel with:

- Root Directory: `frontend`
- Build Command: `npm run build`
- Output: Next.js default
- Environment Variables for private Hugging Face Space backend:
  - `HF_API_URL=https://your-space.hf.space`
  - `HF_TOKEN=hf_your_token`

The browser calls Vercel API routes under `/api/*`; Vercel forwards requests to the private backend with `HF_TOKEN`, so the token is not exposed to the browser.

### Render Backend

Render can use `backend/render.yaml`, or configure manually:

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Environment Variable: `FRONTEND_ORIGINS=https://your-vercel-app.vercel.app`

### Zeabur Backend

Create a Zeabur service from the GitHub repo:

- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}`
- Environment Variables:
  - `OSRM_BASE_URL=https://router.project-osrm.org`
  - `FRONTEND_ORIGINS=https://your-vercel-app.vercel.app`

`backend/zbpack.json` includes the same commands so Zeabur can auto-configure the Python service.

## Routing API

The backend can use real road distance/time from an OSRM-compatible routing API.

```bash
$env:OSRM_BASE_URL="https://router.project-osrm.org"
```

OSRM follows real roads, but does not include live traffic. For traffic-aware VRP analysis, use Google Routes API:

```bash
$env:ROUTING_PROVIDER="google"
$env:GOOGLE_MAPS_API_KEY="your_google_maps_key"
$env:GOOGLE_ROUTING_PREFERENCE="TRAFFIC_AWARE"
$env:GOOGLE_TRAFFIC_BUCKETS="08:00,09:00,10:00,13:00,15:00,17:00"
```

With Google routing enabled, the optimizer matrix uses traffic-aware travel duration, and map route lines use Google road polylines. Fixed-time stops use the traffic bucket closest to their time window; flexible stops can use the best bucket and are encouraged to cluster before/after nearby fixed-time anchors. If Google routing is unavailable, the backend falls back to OSRM when configured, then to a haversine travel-time simulation so the studio remains usable offline.

Mapbox Directions/Matrix can also be used for traffic-aware routing:

```bash
$env:ROUTING_PROVIDER="mapbox"
$env:MAPBOX_ACCESS_TOKEN="your_mapbox_token"
$env:MAPBOX_PROFILE="mapbox/driving-traffic"
$env:MAPBOX_TRAFFIC_BUCKETS="08:00,09:00,10:00,13:00,15:00,17:00"
```

With `mapbox/driving-traffic`, each Matrix API request is limited to 10 coordinates by Mapbox. The backend now splits larger VRP matrices into source/destination batches and recombines them, so many-stop traffic-aware scenarios can still run. The tradeoff is request volume: more stops and more `MAPBOX_TRAFFIC_BUCKETS` mean more Matrix API calls. You can lower the per-request batch size with `MAPBOX_MATRIX_BATCH_SIZE` when testing rate limits. For route geometry on the map, Mapbox Directions still has waypoint limits; very large routes fall back to OSRM/simulated geometry if configured.

## Cost Model

The optimize request accepts an editable test `costModel`. These values are assumptions for simulation, not accounting data:

- `vehicleFixedCost`: fixed cost per active vehicle
- `costPerKm`: distance cost
- `costPerHour`: travel/service time cost
- `overtimeCostPerHour`: cost after `driverShiftMinutes`
- `latePenaltyPerStop`: penalty for missed fixed time windows
- `unassignedPenaltyPerOrder`: penalty for orders that cannot be assigned

The backend uses distance/time costs and active vehicle fixed cost in OR-Tools, then returns `totalCost`, `costBreakdown`, per-route costs, and a Thai run summary explaining what happened in the plan.

## PostgreSQL

`backend/schema.sql` defines the core tables for scenario persistence. The current app runs in-memory for fast simulation workflows.
