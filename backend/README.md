---
title: VRP Demo API
emoji: 🚚
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# VRP Demo API

FastAPI backend for the VRP Simulation Studio.

## Routing Modes

Default routing can use OSRM-compatible road routing:

```bash
OSRM_BASE_URL=https://router.project-osrm.org
ROUTING_PROVIDER=osrm
```

For traffic-aware VRP analysis, enable Google Routes API:

```bash
ROUTING_PROVIDER=google
GOOGLE_MAPS_API_KEY=your_google_maps_key
GOOGLE_ROUTING_PREFERENCE=TRAFFIC_AWARE
GOOGLE_TRAFFIC_BUCKETS=08:00,09:00,10:00,13:00,15:00,17:00
```

Google mode uses `Compute Route Matrix` for traffic-aware travel times in OR-Tools and `computeRoutes` for road-following map polylines. Fixed-time stops use the closest traffic bucket; flexible stops use the best available bucket and get a lower adjacency cost when they are near a fixed-time anchor.

Mapbox mode can be enabled with:

```bash
ROUTING_PROVIDER=mapbox
MAPBOX_ACCESS_TOKEN=your_mapbox_token
MAPBOX_PROFILE=mapbox/driving-traffic
MAPBOX_TRAFFIC_BUCKETS=08:00,09:00,10:00,13:00,15:00,17:00
```

Mapbox `driving-traffic` uses live/historic traffic where covered and supports up to 10 coordinates for Matrix API requests. Use `MAPBOX_PROFILE=mapbox/driving` for up to 25 coordinates without traffic-aware durations.

## Cost Model

`POST /api/optimize` supports an optional `costModel` object for simulation:

```json
{
  "vehicleFixedCost": 1200,
  "costPerKm": 12,
  "costPerHour": 180,
  "overtimeCostPerHour": 250,
  "driverShiftMinutes": 480,
  "latePenaltyPerStop": 500,
  "unassignedPenaltyPerOrder": 2000
}
```

The model is intentionally editable test data. The optimizer uses variable distance/time cost and active vehicle fixed cost while planning, then returns route-level costs, `costBreakdown`, `totalCost`, and `summary`.
