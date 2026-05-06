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

The backend can use real travel distance/time from an OSRM-compatible routing API.

```bash
$env:OSRM_BASE_URL="https://router.project-osrm.org"
```

If no routing API is available, it falls back to a haversine travel-time simulation so the studio remains usable offline.

## PostgreSQL

`backend/schema.sql` defines the core tables for scenario persistence. The current app runs in-memory for fast simulation workflows.
