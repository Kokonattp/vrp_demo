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
