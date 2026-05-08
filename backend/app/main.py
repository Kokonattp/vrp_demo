import math
import os
import re
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
except ImportError:  # pragma: no cover - lets local dev run before dependencies are installed
    pywrapcp = None
    routing_enums_pb2 = None


ROUTE_COLORS = ["#047f8f", "#d97706", "#6d5dfc", "#0f766e", "#be123c"]
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org").rstrip("/")
ROUTING_PROVIDER = os.getenv("ROUTING_PROVIDER", "osrm").strip().lower()
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
GOOGLE_ROUTING_PREFERENCE = os.getenv("GOOGLE_ROUTING_PREFERENCE", "TRAFFIC_AWARE").strip().upper()
GOOGLE_TRAFFIC_BUCKETS = [
    value.strip()
    for value in os.getenv("GOOGLE_TRAFFIC_BUCKETS", "08:00,09:00,10:00,13:00,15:00,17:00").split(",")
    if value.strip()
]
GOOGLE_TRAFFIC_TIMEZONE_OFFSET = os.getenv("GOOGLE_TRAFFIC_TIMEZONE_OFFSET", "+07:00").strip()
MAPBOX_ACCESS_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "").strip()
MAPBOX_PROFILE = os.getenv("MAPBOX_PROFILE", "mapbox/driving-traffic").strip()
MAPBOX_TRAFFIC_BUCKETS = [
    value.strip()
    for value in os.getenv("MAPBOX_TRAFFIC_BUCKETS", "08:00,09:00,10:00,13:00,15:00,17:00").split(",")
    if value.strip()
]
MAPBOX_TRAFFIC_TIMEZONE_OFFSET = os.getenv("MAPBOX_TRAFFIC_TIMEZONE_OFFSET", "+07:00").strip()
MAPBOX_MATRIX_BATCH_SIZE = os.getenv("MAPBOX_MATRIX_BATCH_SIZE", "0").strip()
ANCHOR_CLUSTER_MAX_KM = float(os.getenv("ANCHOR_CLUSTER_MAX_KM", "6"))
ANCHOR_CLUSTER_MAX_MINUTES = int(os.getenv("ANCHOR_CLUSTER_MAX_MINUTES", "25"))
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]
STUDIO_SYNC_FILE = Path(os.getenv("STUDIO_SYNC_FILE", "data/studio-sync.json"))


class Coordinate(BaseModel):
    lat: float
    lng: float


class LocationPoint(Coordinate):
    id: str
    name: str
    type: Literal["depot", "store"]
    address: str | None = None
    clusterId: str | None = None
    clusterLocked: bool = False
    preferredDays: list[str] = Field(default_factory=list)
    preferredTimeWindow: str | None = None
    serviceFrequency: Literal["daily", "weekly", "biweekly", "monthly"] | None = None
    zoneHint: str | None = None
    vehicleRestriction: str | None = None


class Vehicle(BaseModel):
    id: str
    name: str
    capacityKg: float
    capacityCbm: float
    maxStops: int
    startLocationId: str
    endLocationId: str
    restrictedZones: list[str] = Field(default_factory=list)


class Order(BaseModel):
    id: str
    locationId: str
    serviceDate: str | None = None
    timeMode: Literal["fixed", "flexible"] = "fixed"
    weightKg: float
    cbm: float
    serviceMinutes: int
    timeWindowStart: str
    timeWindowEnd: str
    priority: Literal["normal", "high"]


class CostModel(BaseModel):
    vehicleFixedCost: float = 1200
    costPerKm: float = 12
    costPerHour: float = 180
    overtimeCostPerHour: float = 250
    driverShiftMinutes: int = 480
    latePenaltyPerStop: float = 500
    unassignedPenaltyPerOrder: float = 2000


class OptimizeRequest(BaseModel):
    scenarioId: str
    depotId: str
    locations: list[LocationPoint]
    vehicles: list[Vehicle]
    orders: list[Order]
    costModel: CostModel = Field(default_factory=CostModel)


class RouteStop(BaseModel):
    locationId: str
    orderId: str | None = None
    name: str
    lat: float
    lng: float
    arrivalMinutes: int
    loadKg: float
    loadCbm: float
    serviceMinutes: int
    warnings: list[str]


class RoutePlan(BaseModel):
    vehicleId: str
    vehicleName: str
    color: str
    stops: list[RouteStop]
    distanceKm: float
    durationMinutes: int
    loadKg: float
    loadCbm: float
    warnings: list[str]
    routeNotes: list[str] = Field(default_factory=list)
    fixedCost: float = 0
    distanceCost: float = 0
    timeCost: float = 0
    overtimeCost: float = 0
    latePenalty: float = 0
    totalCost: float = 0
    geometry: list[Coordinate]


class ManualRouteRequest(BaseModel):
    scenarioId: str
    route: RoutePlan
    locations: list[LocationPoint]
    vehicles: list[Vehicle]
    orders: list[Order]
    costModel: CostModel = Field(default_factory=CostModel)


class StudioSyncPayload(BaseModel):
    state: dict[str, Any] | None = None
    savedRoutePlans: list[dict[str, Any]] = Field(default_factory=list)
    updatedAt: str | None = None


class ScenarioResult(BaseModel):
    scenarioId: str
    status: Literal["optimized", "fallback", "infeasible"]
    objective: float
    totalDistanceKm: float
    totalDurationMinutes: int
    totalCost: float = 0
    costBreakdown: dict[str, float] = Field(default_factory=dict)
    summary: list[str] = Field(default_factory=list)
    unassignedOrders: list[str]
    warnings: list[str]
    routes: list[RoutePlan]


app = FastAPI(title="VRP Simulation Studio API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"name": "VRP Simulation Studio API", "status": "ok"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "routingProvider": active_routing_provider(),
        "routingApi": bool(OSRM_BASE_URL or GOOGLE_MAPS_API_KEY or MAPBOX_ACCESS_TOKEN),
        "trafficAware": active_routing_provider() in {"google", "mapbox"} and active_routing_profile_is_traffic_aware(),
        "ortools": pywrapcp is not None,
    }


def read_studio_sync() -> dict[str, Any]:
    if not STUDIO_SYNC_FILE.exists():
        return {"state": None, "savedRoutePlans": [], "updatedAt": None}
    try:
        with STUDIO_SYNC_FILE.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        return {
            "state": payload.get("state"),
            "savedRoutePlans": payload.get("savedRoutePlans") if isinstance(payload.get("savedRoutePlans"), list) else [],
            "updatedAt": payload.get("updatedAt"),
        }
    except (OSError, json.JSONDecodeError):
        return {"state": None, "savedRoutePlans": [], "updatedAt": None}


def write_studio_sync(payload: StudioSyncPayload) -> dict[str, Any]:
    next_payload = {
        "state": payload.state,
        "savedRoutePlans": payload.savedRoutePlans[:24],
        "updatedAt": payload.updatedAt or datetime.now(timezone.utc).isoformat(),
    }
    STUDIO_SYNC_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = STUDIO_SYNC_FILE.with_suffix(f"{STUDIO_SYNC_FILE.suffix}.tmp")
    with temp_file.open("w", encoding="utf-8") as file:
        json.dump(next_payload, file, ensure_ascii=False)
    temp_file.replace(STUDIO_SYNC_FILE)
    return next_payload


@app.get("/api/studio-sync")
def get_studio_sync():
    return read_studio_sync()


@app.put("/api/studio-sync")
def put_studio_sync(payload: StudioSyncPayload):
    return write_studio_sync(payload)


@app.post("/api/studio-sync")
def post_studio_sync(payload: StudioSyncPayload):
    return write_studio_sync(payload)


@app.get("/kaitheathcheck")
def leapcell_healthcheck():
    return {"status": "ok"}


@app.get("/kaithealthcheck")
def leapcell_healthcheck_alt():
    return {"status": "ok"}


@app.get("/kaithhealth")
def leapcell_startup_probe():
    return {"status": "ok"}


@app.post("/api/optimize", response_model=ScenarioResult)
async def optimize(request: OptimizeRequest):
    if not request.locations or not request.vehicles or not request.orders:
        return ScenarioResult(
            scenarioId=request.scenarioId,
            status="infeasible",
            objective=0,
            totalDistanceKm=0,
            totalDurationMinutes=0,
            totalCost=round(len(request.orders) * request.costModel.unassignedPenaltyPerOrder, 2),
            costBreakdown={
                "fixedCost": 0,
                "distanceCost": 0,
                "timeCost": 0,
                "overtimeCost": 0,
                "latePenalty": 0,
                "unassignedPenalty": round(len(request.orders) * request.costModel.unassignedPenaltyPerOrder, 2),
            },
            summary=["ยังคำนวณไม่ได้ เพราะต้องมีข้อมูลคลัง/สาขา รถ และออเดอร์ก่อนรัน VRP"],
            unassignedOrders=[order.id for order in request.orders],
            warnings=["Locations, vehicles, and orders are required."],
            routes=[],
        )

    location_by_id = {location.id: location for location in request.locations}
    depot = location_by_id.get(request.depotId) or request.locations[0]
    nodes = [depot]
    node_orders: list[Order | None] = [None]
    for order in request.orders:
        location = location_by_id.get(order.locationId)
        if location:
            nodes.append(location)
            node_orders.append(order)

    distance_matrix, duration_matrix, routing_warning = await build_matrices(nodes, node_orders)
    if pywrapcp is None:
        return build_greedy_result(request, nodes, node_orders, distance_matrix, duration_matrix, routing_warning)

    manager = pywrapcp.RoutingIndexManager(len(nodes), len(request.vehicles), [0] * len(request.vehicles), [0] * len(request.vehicles))
    routing = pywrapcp.RoutingModel(manager)

    cost_matrix = build_cost_matrix(distance_matrix, duration_matrix, node_orders, request.costModel)

    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return cost_matrix[from_node][to_node]

    transit_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_index)
    for vehicle_id in range(len(request.vehicles)):
        routing.SetFixedCostOfVehicle(max(0, int(request.costModel.vehicleFixedCost * 100)), vehicle_id)

    demands_kg = [0] + [int(order.weightKg) for order in request.orders if order.locationId in location_by_id]
    demands_cbm = [0] + [int(order.cbm * 100) for order in request.orders if order.locationId in location_by_id]

    def kg_callback(from_index: int) -> int:
        return demands_kg[manager.IndexToNode(from_index)]

    def cbm_callback(from_index: int) -> int:
        return demands_cbm[manager.IndexToNode(from_index)]

    kg_index = routing.RegisterUnaryTransitCallback(kg_callback)
    cbm_index = routing.RegisterUnaryTransitCallback(cbm_callback)
    routing.AddDimensionWithVehicleCapacity(
        kg_index,
        0,
        [int(vehicle.capacityKg) for vehicle in request.vehicles],
        True,
        "Weight",
    )
    routing.AddDimensionWithVehicleCapacity(
        cbm_index,
        0,
        [int(vehicle.capacityCbm * 100) for vehicle in request.vehicles],
        True,
        "Cbm",
    )

    service_minutes = [0] + [order.serviceMinutes for order in request.orders if order.locationId in location_by_id]

    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(duration_matrix[from_node][to_node] + service_minutes[from_node])

    time_index = routing.RegisterTransitCallback(time_callback)
    routing.AddDimension(time_index, 12 * 60, 24 * 60, False, "Time")
    time_dimension = routing.GetDimensionOrDie("Time")

    for node_index, order in enumerate(node_orders):
        index = manager.NodeToIndex(node_index)
        if order and is_fixed_order(order):
            start = time_to_minutes(order.timeWindowStart)
            end = time_to_minutes(order.timeWindowEnd)
            time_dimension.CumulVar(index).SetRange(start, end)
        else:
            time_dimension.CumulVar(index).SetRange(7 * 60, 20 * 60)

    for vehicle_id in range(len(request.vehicles)):
        time_dimension.CumulVar(routing.Start(vehicle_id)).SetRange(8 * 60, 8 * 60)
        time_dimension.CumulVar(routing.End(vehicle_id)).SetRange(8 * 60, 20 * 60)
        routing.AddVariableMinimizedByFinalizer(time_dimension.CumulVar(routing.Start(vehicle_id)))
        routing.AddVariableMinimizedByFinalizer(time_dimension.CumulVar(routing.End(vehicle_id)))

    for node_index, order in enumerate(node_orders[1:], start=1):
        priority_factor = 2.5 if order and order.priority == "high" else 1.0
        penalty = max(100_000, int(request.costModel.unassignedPenaltyPerOrder * priority_factor * 100))
        routing.AddDisjunction([manager.NodeToIndex(node_index)], penalty)

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_parameters.time_limit.FromSeconds(5)

    solution = routing.SolveWithParameters(search_parameters)
    if not solution:
        return build_greedy_result(request, nodes, node_orders, distance_matrix, duration_matrix, routing_warning)

    result = await build_solution_result(
        request,
        nodes,
        node_orders,
        manager,
        routing,
        solution,
        distance_matrix,
        duration_matrix,
        routing_warning,
    )
    return result


@app.post("/api/route/manual", response_model=RoutePlan)
async def reroute_manual_route(request: ManualRouteRequest):
    if not request.route.stops:
        return request.route

    location_by_id = {location.id: location for location in request.locations}
    order_by_id = {order.id: order for order in request.orders}
    vehicle = next(
        (
            candidate
            for candidate in request.vehicles
            if candidate.id == request.route.vehicleId or candidate.name == request.route.vehicleName
        ),
        None,
    )

    start_location_id = request.route.stops[0].locationId
    end_location_id = request.route.stops[-1].locationId
    start_location = location_by_id.get(start_location_id) or next(
        (location for location in request.locations if location.type == "depot"),
        request.locations[0],
    )
    end_location = location_by_id.get(end_location_id) or start_location
    ordered_orders = [order_by_id[stop.orderId] for stop in request.route.stops if stop.orderId in order_by_id]
    route_locations = [start_location]
    route_orders: list[Order | None] = [None]
    for order in ordered_orders:
        location = location_by_id.get(order.locationId)
        if not location:
            continue
        route_locations.append(location)
        route_orders.append(order)
    route_locations.append(end_location)
    route_orders.append(None)

    if len(route_locations) <= 2:
        return request.route

    distance_matrix, duration_matrix, routing_warning = await build_matrices(route_locations, route_orders)
    elapsed = request.route.stops[0].arrivalMinutes or 8 * 60
    start_minutes = elapsed
    route_distance = 0.0
    route_duration = 0
    load_kg = 0.0
    load_cbm = 0.0
    warnings: list[str] = []
    stops: list[RouteStop] = []

    for index, location in enumerate(route_locations):
        order = route_orders[index]
        if index > 0:
            previous = index - 1
            route_distance += distance_matrix[previous][index]
            route_duration += duration_matrix[previous][index]
            elapsed += duration_matrix[previous][index]

        stop_warnings: list[str] = []
        if order:
            if is_fixed_order(order) and elapsed < time_to_minutes(order.timeWindowStart):
                elapsed = time_to_minutes(order.timeWindowStart)
            if is_fixed_order(order) and elapsed > time_to_minutes(order.timeWindowEnd):
                stop_warnings.append("Time window")
                warnings.append(f"{order.id} misses {order.timeWindowEnd}")
            load_kg += order.weightKg
            load_cbm += order.cbm

        stops.append(
            RouteStop(
                locationId=location.id,
                orderId=order.id if order else None,
                name=location.name,
                lat=location.lat,
                lng=location.lng,
                arrivalMinutes=int(elapsed),
                loadKg=round(load_kg, 2),
                loadCbm=round(load_cbm, 2),
                serviceMinutes=order.serviceMinutes if order else 0,
                warnings=stop_warnings,
            )
        )

        if order:
            elapsed += order.serviceMinutes

    if vehicle:
        if load_kg > vehicle.capacityKg:
            warnings.append(f"{vehicle.name} capacity kg exceeded")
        if load_cbm > vehicle.capacityCbm:
            warnings.append(f"{vehicle.name} capacity CBM exceeded")
        if len(ordered_orders) > vehicle.maxStops:
            warnings.append(f"{vehicle.name} max stops exceeded")

    if routing_warning:
        warnings.append(routing_warning)

    duration_minutes = max(0, int(round(elapsed - start_minutes)))
    late_stop_count = sum(1 for stop in stops for warning in stop.warnings if warning == "Time window")
    route_cost = calculate_route_cost(route_distance, duration_minutes, late_stop_count, request.costModel)
    geometry = await build_route_geometry(route_locations)
    provider = active_routing_provider()
    route_notes = [
        f"Manual sequence rerouted with {provider} using locked stop order.",
        f"Traffic-aware: {'yes' if provider in {'google', 'mapbox'} and active_routing_profile_is_traffic_aware() else 'no'}",
    ]
    if routing_warning:
        route_notes.append(routing_warning)

    return RoutePlan(
        vehicleId=request.route.vehicleId,
        vehicleName=request.route.vehicleName,
        color=request.route.color,
        stops=stops,
        distanceKm=round(route_distance, 1),
        durationMinutes=duration_minutes,
        loadKg=round(load_kg, 1),
        loadCbm=round(load_cbm, 1),
        warnings=warnings,
        routeNotes=route_notes,
        fixedCost=route_cost["fixedCost"],
        distanceCost=route_cost["distanceCost"],
        timeCost=route_cost["timeCost"],
        overtimeCost=route_cost["overtimeCost"],
        latePenalty=route_cost["latePenalty"],
        totalCost=route_cost["totalCost"],
        geometry=geometry,
    )


async def build_matrices(
    nodes: list[LocationPoint], node_orders: list[Order | None]
) -> tuple[list[list[float]], list[list[int]], str | None]:
    if active_routing_provider() == "google":
        google_result = await build_google_traffic_matrices(nodes, node_orders)
        if google_result:
            return google_result
        if not OSRM_BASE_URL:
            return build_simulated_matrices(nodes, "Google traffic routing unavailable; simulated travel matrix used.")

    if active_routing_provider() == "mapbox":
        mapbox_result = await build_mapbox_traffic_matrices(nodes, node_orders)
        if mapbox_result:
            return mapbox_result
        if not OSRM_BASE_URL:
            return build_simulated_matrices(nodes, "Mapbox traffic routing unavailable; simulated travel matrix used.")

    if OSRM_BASE_URL:
        coordinates = ";".join(f"{node.lng},{node.lat}" for node in nodes)
        url = f"{OSRM_BASE_URL}/table/v1/driving/{coordinates}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(url, params={"annotations": "distance,duration"})
                response.raise_for_status()
                payload = response.json()
                distances = [[round(cell / 1000, 2) for cell in row] for row in payload["distances"]]
                durations = [[max(1, round(cell / 60)) for cell in row] for row in payload["durations"]]
                warning = None
                if ROUTING_PROVIDER in {"google", "mapbox"}:
                    warning = f"{ROUTING_PROVIDER.title()} traffic routing unavailable; OSRM road routing used without live traffic."
                return distances, durations, warning
        except Exception:
            pass

    return build_simulated_matrices(nodes, "Routing API unavailable; simulated travel matrix used.")


async def build_google_traffic_matrices(
    nodes: list[LocationPoint], node_orders: list[Order | None]
) -> tuple[list[list[float]], list[list[int]], str | None] | None:
    service_date = next((order.serviceDate for order in node_orders if order and order.serviceDate), None)
    bucket_times = GOOGLE_TRAFFIC_BUCKETS or ["08:00"]
    bucket_results: list[tuple[str, list[list[float]], list[list[int]]]] = []

    for bucket in bucket_times:
        departure_time = google_departure_time(service_date, bucket)
        result = await build_google_matrices(nodes, departure_time)
        if result:
            distances, durations, _ = result
            bucket_results.append((bucket, distances, durations))

    if not bucket_results:
        return None

    distances = bucket_results[0][1]
    durations = merge_traffic_bucket_durations(bucket_results, node_orders)
    warning = f"Google traffic-aware routing used with time buckets: {', '.join(bucket for bucket, _, _ in bucket_results)}."
    return distances, durations, warning


def build_simulated_matrices(nodes: list[LocationPoint], warning: str) -> tuple[list[list[float]], list[list[int]], str]:
    distances: list[list[float]] = []
    durations: list[list[int]] = []
    for origin in nodes:
        distance_row = []
        duration_row = []
        for destination in nodes:
            km = haversine_km(origin, destination) * 1.28
            distance_row.append(round(km, 2))
            duration_row.append(max(1, round((km / 30) * 60)))
        distances.append(distance_row)
        durations.append(duration_row)
    return distances, durations, warning


async def build_mapbox_traffic_matrices(
    nodes: list[LocationPoint], node_orders: list[Order | None]
) -> tuple[list[list[float]], list[list[int]], str | None] | None:
    service_date = next((order.serviceDate for order in node_orders if order and order.serviceDate), None)
    if active_routing_profile_is_traffic_aware():
        bucket_times = MAPBOX_TRAFFIC_BUCKETS or ["08:00"]
        bucket_results: list[tuple[str, list[list[float]], list[list[int]]]] = []
        bucket_warnings: list[str] = []
        for bucket in bucket_times:
            result = await build_mapbox_matrix(nodes, mapbox_departure_time(service_date, bucket))
            if result:
                distances, durations, matrix_warning = result
                bucket_results.append((bucket, distances, durations))
                if matrix_warning and matrix_warning not in bucket_warnings:
                    bucket_warnings.append(matrix_warning)
        if not bucket_results:
            return None
        distances = bucket_results[0][1]
        durations = merge_traffic_bucket_durations(bucket_results, node_orders)
        warning = f"Mapbox traffic-aware routing used with time buckets: {', '.join(bucket for bucket, _, _ in bucket_results)}."
        if bucket_warnings:
            warning = f"{warning} {' '.join(bucket_warnings)}"
        return distances, durations, warning

    result = await build_mapbox_matrix(nodes, None)
    if result:
        distances, durations, matrix_warning = result
        warning = "Mapbox road routing used without driving-traffic profile."
        if matrix_warning:
            warning = f"{warning} {matrix_warning}"
        return distances, durations, warning
    return None


async def build_mapbox_matrix(
    nodes: list[LocationPoint], departure_time: str | None = None
) -> tuple[list[list[float]], list[list[int]], str | None] | None:
    if not MAPBOX_ACCESS_TOKEN or len(nodes) < 2:
        return None
    max_coordinates = mapbox_matrix_coordinate_limit()
    if len(nodes) > max_coordinates:
        return await build_mapbox_matrix_batches(nodes, departure_time, max_coordinates)

    payload = await fetch_mapbox_matrix(nodes, departure_time)
    if not payload:
        return None
    raw_distances, raw_durations = payload
    distances, durations, fallback_cells = normalize_mapbox_matrix(nodes, raw_distances, raw_durations)
    warning = f"Mapbox matrix used simulated fallback for {fallback_cells} unreachable cells." if fallback_cells else None
    return distances, durations, warning


async def build_mapbox_matrix_batches(
    nodes: list[LocationPoint],
    departure_time: str | None,
    coordinate_limit: int,
) -> tuple[list[list[float]], list[list[int]], str | None] | None:
    size = len(nodes)
    origin_chunk_size = max(1, coordinate_limit // 2)
    destination_chunk_size = max(1, coordinate_limit - origin_chunk_size)
    raw_distances: list[list[float | None]] = [[None for _ in nodes] for _ in nodes]
    raw_durations: list[list[float | None]] = [[None for _ in nodes] for _ in nodes]
    request_count = 0
    failed_batches = 0

    for origin_indices in chunk_indices(size, origin_chunk_size):
        for destination_indices in chunk_indices(size, destination_chunk_size):
            subset_indices = unique_indices([*origin_indices, *destination_indices])
            source_positions = [subset_indices.index(index) for index in origin_indices]
            destination_positions = [subset_indices.index(index) for index in destination_indices]
            subset_nodes = [nodes[index] for index in subset_indices]
            payload = await fetch_mapbox_matrix(subset_nodes, departure_time, source_positions, destination_positions)
            request_count += 1
            if not payload:
                failed_batches += 1
                continue
            batch_distances, batch_durations = payload
            for source_row, origin_index in enumerate(origin_indices):
                for destination_column, destination_index in enumerate(destination_indices):
                    raw_distances[origin_index][destination_index] = cell_or_none(batch_distances, source_row, destination_column)
                    raw_durations[origin_index][destination_index] = cell_or_none(batch_durations, source_row, destination_column)

    if all(cell is None for row in raw_durations for cell in row):
        return None

    distances, durations, fallback_cells = normalize_mapbox_matrix(nodes, raw_distances, raw_durations)
    warning_parts = [f"Mapbox Matrix API batched into {request_count} requests for {size} coordinates."]
    if fallback_cells:
        warning_parts.append(f"{fallback_cells} cells used simulated fallback.")
    if failed_batches:
        warning_parts.append(f"{failed_batches} batches failed.")
    return distances, durations, " ".join(warning_parts)


async def fetch_mapbox_matrix(
    nodes: list[LocationPoint],
    departure_time: str | None = None,
    source_positions: list[int] | None = None,
    destination_positions: list[int] | None = None,
) -> tuple[list[list[float | None]], list[list[float | None]]] | None:
    coordinates = ";".join(f"{node.lng},{node.lat}" for node in nodes)
    url = f"https://api.mapbox.com/directions-matrix/v1/{MAPBOX_PROFILE}/{coordinates}"
    params = {
        "annotations": "distance,duration",
        "access_token": MAPBOX_ACCESS_TOKEN,
    }
    if source_positions is not None:
        params["sources"] = ";".join(str(index) for index in source_positions)
    if destination_positions is not None:
        params["destinations"] = ";".join(str(index) for index in destination_positions)
    if departure_time and MAPBOX_PROFILE == "mapbox/driving-traffic":
        params["depart_at"] = departure_time

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    if payload.get("code") not in (None, "Ok", "NoRoute"):
        return None
    return payload.get("distances") or [], payload.get("durations") or []


def normalize_mapbox_matrix(
    nodes: list[LocationPoint],
    raw_distances: list[list[float | None]],
    raw_durations: list[list[float | None]],
) -> tuple[list[list[float]], list[list[int]], int]:
    simulated_distances, simulated_durations, _ = build_simulated_matrices(nodes, "")
    distances: list[list[float]] = []
    durations: list[list[int]] = []
    fallback_cells = 0
    for origin_index in range(len(nodes)):
        distance_row: list[float] = []
        duration_row: list[int] = []
        for destination_index in range(len(nodes)):
            distance_meters = cell_or_none(raw_distances, origin_index, destination_index)
            duration_seconds = cell_or_none(raw_durations, origin_index, destination_index)
            if not isinstance(distance_meters, (int, float)) or not isinstance(duration_seconds, (int, float)):
                fallback_cells += 1
            distance_row.append(
                round(distance_meters / 1000, 2)
                if isinstance(distance_meters, (int, float))
                else simulated_distances[origin_index][destination_index]
            )
            duration_row.append(
                max(0, round(duration_seconds / 60))
                if isinstance(duration_seconds, (int, float))
                else simulated_durations[origin_index][destination_index]
            )
        distances.append(distance_row)
        durations.append(duration_row)

    return distances, durations, fallback_cells


def mapbox_matrix_coordinate_limit() -> int:
    provider_limit = 10 if MAPBOX_PROFILE == "mapbox/driving-traffic" else 25
    try:
        configured_limit = int(MAPBOX_MATRIX_BATCH_SIZE)
    except ValueError:
        configured_limit = 0
    if configured_limit <= 0:
        return provider_limit
    return max(2, min(provider_limit, configured_limit))


def chunk_indices(size: int, chunk_size: int) -> list[list[int]]:
    return [list(range(start, min(start + chunk_size, size))) for start in range(0, size, chunk_size)]


def unique_indices(indices: list[int]) -> list[int]:
    seen: set[int] = set()
    unique: list[int] = []
    for index in indices:
        if index in seen:
            continue
        seen.add(index)
        unique.append(index)
    return unique


async def build_google_matrices(
    nodes: list[LocationPoint], departure_time: str | None = None
) -> tuple[list[list[float]], list[list[int]], str | None] | None:
    if not GOOGLE_MAPS_API_KEY:
        return None

    element_count = len(nodes) * len(nodes)
    if GOOGLE_ROUTING_PREFERENCE == "TRAFFIC_AWARE_OPTIMAL" and element_count > 100:
        return None

    url = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
    body = {
        "origins": [{"waypoint": google_waypoint(node)} for node in nodes],
        "destinations": [{"waypoint": google_waypoint(node)} for node in nodes],
        "travelMode": "DRIVE",
        "routingPreference": GOOGLE_ROUTING_PREFERENCE,
        "departureTime": departure_time or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(url, json=body, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except Exception:
        return None

    distances = [[0.0 for _ in nodes] for _ in nodes]
    durations = [[0 for _ in nodes] for _ in nodes]
    for element in payload:
        origin_index = element.get("originIndex")
        destination_index = element.get("destinationIndex")
        if origin_index is None or destination_index is None:
            continue
        distance_meters = element.get("distanceMeters", 0)
        duration_seconds = parse_google_duration_seconds(element.get("duration", "0s"))
        distances[origin_index][destination_index] = round(distance_meters / 1000, 2)
        durations[origin_index][destination_index] = max(0, round(duration_seconds / 60))

    return distances, durations, None


def merge_traffic_bucket_durations(
    bucket_results: list[tuple[str, list[list[float]], list[list[int]]]], node_orders: list[Order | None]
) -> list[list[int]]:
    size = len(node_orders)
    merged = [[0 for _ in range(size)] for _ in range(size)]

    for origin_index in range(size):
        for destination_index in range(size):
            destination_order = node_orders[destination_index]
            if origin_index == destination_index:
                merged[origin_index][destination_index] = 0
            elif destination_order and is_fixed_order(destination_order):
                bucket_index = closest_bucket_index(destination_order.timeWindowStart, bucket_results)
                merged[origin_index][destination_index] = bucket_results[bucket_index][2][origin_index][destination_index]
            else:
                merged[origin_index][destination_index] = min(
                    bucket[2][origin_index][destination_index] for bucket in bucket_results
                )

    return merged


def closest_bucket_index(time_value: str, bucket_results: list[tuple[str, list[list[float]], list[list[int]]]]) -> int:
    target = time_to_minutes(time_value)
    distances = [abs(time_to_minutes(bucket) - target) for bucket, _, _ in bucket_results]
    return distances.index(min(distances))


def google_departure_time(service_date: str | None, clock_time: str) -> str:
    if service_date:
        return f"{service_date}T{clock_time}:00{GOOGLE_TRAFFIC_TIMEZONE_OFFSET}"
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def mapbox_departure_time(service_date: str | None, clock_time: str) -> str:
    if service_date:
        return f"{service_date}T{clock_time}:00{MAPBOX_TRAFFIC_TIMEZONE_OFFSET}"
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def cell_or_none(rows: list, row_index: int, column_index: int):
    try:
        return rows[row_index][column_index]
    except (IndexError, TypeError):
        return None


def build_cost_matrix(
    distance_matrix: list[list[float]],
    duration_matrix: list[list[int]],
    node_orders: list[Order | None],
    cost_model: CostModel,
) -> list[list[int]]:
    nearest_anchor = nearest_fixed_anchor_by_node(distance_matrix, duration_matrix, node_orders)
    size = len(node_orders)
    costs = [[0 for _ in range(size)] for _ in range(size)]

    for origin in range(size):
        for destination in range(size):
            if origin == destination:
                costs[origin][destination] = 0
                continue
            variable_cost = (
                distance_matrix[origin][destination] * max(0, cost_model.costPerKm)
                + (duration_matrix[origin][destination] / 60) * max(0, cost_model.costPerHour)
            )
            if variable_cost <= 0:
                variable_cost = distance_matrix[origin][destination] * 10 + duration_matrix[origin][destination]
            base_cost = int(variable_cost * 100)
            origin_order = node_orders[origin]
            destination_order = node_orders[destination]
            cluster_factor = 1.0

            if is_flexible_order(origin_order) and is_fixed_order(destination_order) and is_near_anchor(origin, destination, distance_matrix, duration_matrix):
                cluster_factor = 0.62
            elif is_fixed_order(origin_order) and is_flexible_order(destination_order) and is_near_anchor(origin, destination, distance_matrix, duration_matrix):
                cluster_factor = 0.62
            elif is_flexible_order(origin_order) and is_flexible_order(destination_order):
                origin_anchor = nearest_anchor.get(origin)
                destination_anchor = nearest_anchor.get(destination)
                if origin_anchor and destination_anchor and origin_anchor[0] == destination_anchor[0]:
                    cluster_factor = 0.72

            costs[origin][destination] = max(1, int(base_cost * cluster_factor))

    return costs


def nearest_fixed_anchor_by_node(
    distance_matrix: list[list[float]],
    duration_matrix: list[list[int]],
    node_orders: list[Order | None],
) -> dict[int, tuple[int, float, int]]:
    anchors = [index for index, order in enumerate(node_orders) if is_fixed_order(order)]
    nearest: dict[int, tuple[int, float, int]] = {}

    for index, order in enumerate(node_orders):
        if not is_flexible_order(order):
            continue
        candidates = [
            (anchor, distance_matrix[index][anchor], duration_matrix[index][anchor])
            for anchor in anchors
            if is_near_anchor(index, anchor, distance_matrix, duration_matrix)
        ]
        if candidates:
            nearest[index] = min(candidates, key=lambda item: (item[2], item[1]))

    return nearest


def route_cluster_notes(
    route_nodes: list[int],
    nodes: list[LocationPoint],
    node_orders: list[Order | None],
    distance_matrix: list[list[float]],
    duration_matrix: list[list[int]],
) -> list[str]:
    notes: list[str] = []
    seen: set[tuple[int, int]] = set()

    for left, right in zip(route_nodes, route_nodes[1:]):
        left_order = node_orders[left]
        right_order = node_orders[right]
        if is_flexible_order(left_order) and is_fixed_order(right_order) and is_near_anchor(left, right, distance_matrix, duration_matrix):
            key = (left, right)
            if key not in seen:
                notes.append(
                    f"{nodes[left].name} ถูกจัดก่อน {nodes[right].name} เพราะเป็นจุดยืดหยุ่นที่อยู่ใกล้ anchor เวลา {right_order.timeWindowStart}."
                )
                seen.add(key)
        elif is_fixed_order(left_order) and is_flexible_order(right_order) and is_near_anchor(left, right, distance_matrix, duration_matrix):
            key = (left, right)
            if key not in seen:
                notes.append(
                    f"{nodes[right].name} ถูกจัดต่อจาก {nodes[left].name} เพราะอยู่ใกล้จุดที่กำหนดเวลา {left_order.timeWindowStart}."
                )
                seen.add(key)

    return notes[:3]


def is_near_anchor(
    origin: int,
    destination: int,
    distance_matrix: list[list[float]],
    duration_matrix: list[list[int]],
) -> bool:
    return (
        distance_matrix[origin][destination] <= ANCHOR_CLUSTER_MAX_KM
        or duration_matrix[origin][destination] <= ANCHOR_CLUSTER_MAX_MINUTES
    )


def is_fixed_order(order: Order | None) -> bool:
    return bool(order and order.timeMode == "fixed" and order.timeWindowStart and order.timeWindowEnd)


def is_flexible_order(order: Order | None) -> bool:
    return bool(order and order.timeMode == "flexible")


def calculate_route_cost(
    route_distance_km: float,
    route_duration_minutes: int,
    late_stop_count: int,
    cost_model: CostModel,
) -> dict[str, float]:
    fixed_cost = max(0, cost_model.vehicleFixedCost)
    distance_cost = max(0, route_distance_km) * max(0, cost_model.costPerKm)
    time_cost = (max(0, route_duration_minutes) / 60) * max(0, cost_model.costPerHour)
    overtime_minutes = max(0, route_duration_minutes - max(0, cost_model.driverShiftMinutes))
    overtime_cost = (overtime_minutes / 60) * max(0, cost_model.overtimeCostPerHour)
    late_penalty = max(0, late_stop_count) * max(0, cost_model.latePenaltyPerStop)
    total_cost = fixed_cost + distance_cost + time_cost + overtime_cost + late_penalty
    return {
        "fixedCost": round(fixed_cost, 2),
        "distanceCost": round(distance_cost, 2),
        "timeCost": round(time_cost, 2),
        "overtimeCost": round(overtime_cost, 2),
        "latePenalty": round(late_penalty, 2),
        "totalCost": round(total_cost, 2),
    }


def scenario_cost_breakdown(
    routes: list[RoutePlan],
    unassigned_count: int,
    cost_model: CostModel,
) -> dict[str, float]:
    unassigned_penalty = max(0, unassigned_count) * max(0, cost_model.unassignedPenaltyPerOrder)
    return {
        "fixedCost": round(sum(route.fixedCost for route in routes), 2),
        "distanceCost": round(sum(route.distanceCost for route in routes), 2),
        "timeCost": round(sum(route.timeCost for route in routes), 2),
        "overtimeCost": round(sum(route.overtimeCost for route in routes), 2),
        "latePenalty": round(sum(route.latePenalty for route in routes), 2),
        "unassignedPenalty": round(unassigned_penalty, 2),
        "totalCost": round(sum(route.totalCost for route in routes) + unassigned_penalty, 2),
    }


def format_baht(value: float) -> str:
    return f"{value:,.0f} บาท"


def build_run_summary(
    status: Literal["optimized", "fallback", "infeasible"],
    routes: list[RoutePlan],
    unassigned: list[str],
    warnings: list[str],
    cost_breakdown: dict[str, float],
) -> list[str]:
    if not routes:
        return ["ยังไม่มีเส้นทางที่จัดได้จากข้อมูลชุดนี้"]

    delivery_count = sum(1 for route in routes for stop in route.stops if stop.orderId)
    total_distance = sum(route.distanceKm for route in routes)
    total_duration = sum(route.durationMinutes for route in routes)
    summary = [
        f"ใช้รถ {len(routes)} คัน จัดส่ง {delivery_count} ออเดอร์ ระยะทางรวม {total_distance:.1f} กม. ใช้เวลารวม {total_duration} นาที",
        f"ต้นทุนจำลองรวม {format_baht(cost_breakdown.get('totalCost', 0))} จากค่ารถประจำทาง ระยะทาง เวลา OT และ penalty",
    ]
    if status == "fallback":
        summary.append("ผลลัพธ์นี้เป็นแผน fallback/ประมาณการ ควรกดรันด้วย backend routing จริงเมื่อต้องการใช้งานจริง")
    if unassigned:
        summary.append(f"มีออเดอร์ยังไม่ถูกจัด {len(unassigned)} รายการ และถูกคิด penalty จำลอง {format_baht(cost_breakdown.get('unassignedPenalty', 0))}")
    if warnings:
        summary.append(f"มีข้อเตือน {len(warnings)} รายการ เช่น {warnings[0]}")
    best_route = min(routes, key=lambda route: route.totalCost)
    summary.append(f"เส้นทางต้นทุนต่ำสุดคือ {best_route.vehicleName} ประมาณ {format_baht(best_route.totalCost)}")
    return summary


async def build_solution_result(
    request: OptimizeRequest,
    nodes: list[LocationPoint],
    node_orders: list[Order | None],
    manager,
    routing,
    solution,
    distance_matrix: list[list[float]],
    duration_matrix: list[list[int]],
    routing_warning: str | None,
) -> ScenarioResult:
    time_dimension = routing.GetDimensionOrDie("Time")
    visited_nodes: set[int] = set()
    routes: list[RoutePlan] = []

    for vehicle_index, vehicle in enumerate(request.vehicles):
        index = routing.Start(vehicle_index)
        route_nodes: list[int] = []
        route_indices: list[int] = []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            route_nodes.append(node)
            route_indices.append(index)
            visited_nodes.add(node)
            index = solution.Value(routing.NextVar(index))
        route_nodes.append(manager.IndexToNode(index))
        route_indices.append(index)

        if len(route_nodes) <= 2:
            continue

        stops: list[RouteStop] = []
        route_distance = 0.0
        route_duration = 0
        load_kg = 0.0
        load_cbm = 0.0
        warnings: list[str] = []
        for stop_index, node in enumerate(route_nodes):
            location = nodes[node]
            order = node_orders[node]
            if stop_index > 0:
                previous = route_nodes[stop_index - 1]
                route_distance += distance_matrix[previous][node]
                route_duration += duration_matrix[previous][node]
            arrival = solution.Min(time_dimension.CumulVar(route_indices[stop_index]))
            stop_warnings = []
            if order:
                load_kg += order.weightKg
                load_cbm += order.cbm
                if is_fixed_order(order) and arrival > time_to_minutes(order.timeWindowEnd):
                    stop_warnings.append("Time window")
                    warnings.append(f"{order.id} misses {order.timeWindowEnd}")
            stops.append(
                RouteStop(
                    locationId=location.id,
                    orderId=order.id if order else None,
                    name=location.name,
                    lat=location.lat,
                    lng=location.lng,
                    arrivalMinutes=int(arrival),
                    loadKg=round(load_kg, 2),
                    loadCbm=round(load_cbm, 2),
                    serviceMinutes=order.serviceMinutes if order else 0,
                    warnings=stop_warnings,
                )
            )

        if load_kg > vehicle.capacityKg:
            warnings.append(f"{vehicle.name} capacity kg exceeded")
        if load_cbm > vehicle.capacityCbm:
            warnings.append(f"{vehicle.name} capacity CBM exceeded")
        if len([stop for stop in stops if stop.orderId]) > vehicle.maxStops:
            warnings.append(f"{vehicle.name} max stops exceeded")

        geometry = await build_route_geometry([nodes[node] for node in route_nodes])
        route_notes = route_cluster_notes(route_nodes, nodes, node_orders, distance_matrix, duration_matrix)
        duration_minutes = route_duration + sum(stop.serviceMinutes for stop in stops)
        late_stop_count = sum(1 for stop in stops for warning in stop.warnings if warning == "Time window")
        route_cost = calculate_route_cost(route_distance, duration_minutes, late_stop_count, request.costModel)
        routes.append(
            RoutePlan(
                vehicleId=vehicle.id,
                vehicleName=vehicle.name,
                color=ROUTE_COLORS[vehicle_index % len(ROUTE_COLORS)],
                stops=stops,
                distanceKm=round(route_distance, 1),
                durationMinutes=duration_minutes,
                loadKg=round(load_kg, 1),
                loadCbm=round(load_cbm, 1),
                warnings=warnings,
                routeNotes=route_notes,
                fixedCost=route_cost["fixedCost"],
                distanceCost=route_cost["distanceCost"],
                timeCost=route_cost["timeCost"],
                overtimeCost=route_cost["overtimeCost"],
                latePenalty=route_cost["latePenalty"],
                totalCost=route_cost["totalCost"],
                geometry=geometry,
            )
        )

    unassigned = [node_orders[index].id for index in range(1, len(nodes)) if index not in visited_nodes and node_orders[index]]
    warnings = [routing_warning] if routing_warning else []
    cost_breakdown = scenario_cost_breakdown(routes, len(unassigned), request.costModel)
    return ScenarioResult(
        scenarioId=request.scenarioId,
        status="optimized",
        objective=cost_breakdown["totalCost"],
        totalDistanceKm=round(sum(route.distanceKm for route in routes), 1),
        totalDurationMinutes=sum(route.durationMinutes for route in routes),
        totalCost=cost_breakdown["totalCost"],
        costBreakdown=cost_breakdown,
        summary=build_run_summary("optimized", routes, unassigned, warnings, cost_breakdown),
        unassignedOrders=unassigned,
        warnings=warnings,
        routes=routes,
    )


def build_greedy_result(
    request: OptimizeRequest,
    nodes: list[LocationPoint],
    node_orders: list[Order | None],
    distance_matrix: list[list[float]],
    duration_matrix: list[list[int]],
    routing_warning: str | None,
) -> ScenarioResult:
    vehicle_loads = [{"orders": [], "kg": 0.0, "cbm": 0.0} for _ in request.vehicles]
    unassigned: list[str] = []
    prioritized_orders = sort_orders_for_anchor_clustering(request.orders, request.locations)
    for order in prioritized_orders:
        placed = False
        for index, vehicle in enumerate(request.vehicles):
            load = vehicle_loads[index]
            if (
                len(load["orders"]) < vehicle.maxStops
                and load["kg"] + order.weightKg <= vehicle.capacityKg
                and load["cbm"] + order.cbm <= vehicle.capacityCbm
            ):
                load["orders"].append(order)
                load["kg"] += order.weightKg
                load["cbm"] += order.cbm
                placed = True
                break
        if not placed:
            unassigned.append(order.id)

    location_by_id = {location.id: location for location in request.locations}
    depot = nodes[0]
    routes: list[RoutePlan] = []
    for vehicle_index, vehicle in enumerate(request.vehicles):
        bucket = vehicle_loads[vehicle_index]
        if not bucket["orders"]:
            continue
        route_locations = [depot] + [location_by_id[order.locationId] for order in bucket["orders"]] + [depot]
        elapsed = 8 * 60
        route_distance = 0.0
        stops = []
        warnings = []
        load_kg = 0.0
        load_cbm = 0.0
        for index, location in enumerate(route_locations):
            order = None if index == 0 or index == len(route_locations) - 1 else bucket["orders"][index - 1]
            if index > 0:
                previous = route_locations[index - 1]
                leg = haversine_km(previous, location) * 1.28
                route_distance += leg
                elapsed += int((leg / 30) * 60)
            stop_warnings = []
            if order:
                load_kg += order.weightKg
                load_cbm += order.cbm
                if is_fixed_order(order) and elapsed < time_to_minutes(order.timeWindowStart):
                    elapsed = time_to_minutes(order.timeWindowStart)
                if is_fixed_order(order) and elapsed > time_to_minutes(order.timeWindowEnd):
                    stop_warnings.append("Time window")
                    warnings.append(f"{order.id} misses {order.timeWindowEnd}")
                elapsed += order.serviceMinutes
            stops.append(
                RouteStop(
                    locationId=location.id,
                    orderId=order.id if order else None,
                    name=location.name,
                    lat=location.lat,
                    lng=location.lng,
                    arrivalMinutes=elapsed,
                    loadKg=round(load_kg, 1),
                    loadCbm=round(load_cbm, 1),
                    serviceMinutes=order.serviceMinutes if order else 0,
                    warnings=stop_warnings,
                )
            )
        duration_minutes = max(0, elapsed - 8 * 60)
        late_stop_count = sum(1 for stop in stops for warning in stop.warnings if warning == "Time window")
        route_cost = calculate_route_cost(route_distance, duration_minutes, late_stop_count, request.costModel)
        routes.append(
            RoutePlan(
                vehicleId=vehicle.id,
                vehicleName=vehicle.name,
                color=ROUTE_COLORS[vehicle_index % len(ROUTE_COLORS)],
                stops=stops,
                distanceKm=round(route_distance, 1),
                durationMinutes=duration_minutes,
                loadKg=round(load_kg, 1),
                loadCbm=round(load_cbm, 1),
                warnings=warnings,
                routeNotes=greedy_route_notes(route_locations, bucket["orders"]),
                fixedCost=route_cost["fixedCost"],
                distanceCost=route_cost["distanceCost"],
                timeCost=route_cost["timeCost"],
                overtimeCost=route_cost["overtimeCost"],
                latePenalty=route_cost["latePenalty"],
                totalCost=route_cost["totalCost"],
                geometry=[Coordinate(lat=location.lat, lng=location.lng) for location in route_locations],
            )
        )

    warnings = [routing_warning or "OR-Tools unavailable; greedy fallback used."]
    cost_breakdown = scenario_cost_breakdown(routes, len(unassigned), request.costModel)
    return ScenarioResult(
        scenarioId=request.scenarioId,
        status="fallback",
        objective=cost_breakdown["totalCost"],
        totalDistanceKm=round(sum(route.distanceKm for route in routes), 1),
        totalDurationMinutes=sum(route.durationMinutes for route in routes),
        totalCost=cost_breakdown["totalCost"],
        costBreakdown=cost_breakdown,
        summary=build_run_summary("fallback", routes, unassigned, warnings, cost_breakdown),
        unassignedOrders=unassigned,
        warnings=warnings,
        routes=routes,
    )


def sort_orders_for_anchor_clustering(
    orders: list[Order],
    locations: list[LocationPoint],
) -> list[Order]:
    location_by_id = {location.id: location for location in locations}
    fixed_orders = [order for order in orders if is_fixed_order(order)]

    def order_key(order: Order) -> tuple[int, int, float, str]:
        if is_fixed_order(order):
            return (0, time_to_minutes(order.timeWindowStart), 0, order.id)
        if fixed_orders:
            nearest_fixed = min(
                fixed_orders,
                key=lambda fixed: distance_between_locations(order.locationId, fixed.locationId, location_by_id),
            )
            return (
                1,
                time_to_minutes(nearest_fixed.timeWindowStart),
                distance_between_locations(order.locationId, nearest_fixed.locationId, location_by_id),
                order.id,
            )
        return (2, 0 if order.priority == "high" else 1, 0, order.id)

    return sorted(orders, key=order_key)


def distance_between_locations(
    left_location_id: str,
    right_location_id: str,
    location_by_id: dict[str, LocationPoint],
) -> float:
    left = location_by_id.get(left_location_id)
    right = location_by_id.get(right_location_id)
    if left is None or right is None:
        return 9999
    return haversine_km(left, right)


def greedy_route_notes(route_locations: list[LocationPoint], route_orders: list[Order]) -> list[str]:
    order_by_location_id = {order.locationId: order for order in route_orders}
    notes: list[str] = []

    for previous, current in zip(route_locations, route_locations[1:]):
        previous_order = order_by_location_id.get(previous.id)
        current_order = order_by_location_id.get(current.id)
        if is_fixed_order(previous_order) and is_flexible_order(current_order):
            notes.append(f"{current.name} ถูกจัดต่อจาก {previous.name} เพราะเป็นจุดยืดหยุ่นใกล้ anchor เวลา {previous_order.timeWindowStart}.")
        elif is_flexible_order(previous_order) and is_fixed_order(current_order):
            notes.append(f"{previous.name} ถูกจัดก่อน {current.name} เพราะเป็นจุดยืดหยุ่นใกล้ anchor เวลา {current_order.timeWindowStart}.")

    return notes[:3]


async def build_route_geometry(route_nodes: list[LocationPoint]) -> list[Coordinate]:
    if active_routing_provider() == "google" and len(route_nodes) > 1:
        google_geometry = await build_google_route_geometry(route_nodes)
        if google_geometry:
            return google_geometry

    if active_routing_provider() == "mapbox" and len(route_nodes) > 1:
        mapbox_geometry = await build_mapbox_route_geometry(route_nodes)
        if mapbox_geometry:
            return mapbox_geometry

    if OSRM_BASE_URL and len(route_nodes) > 1:
        coordinates = ";".join(f"{node.lng},{node.lat}" for node in route_nodes)
        url = f"{OSRM_BASE_URL}/route/v1/driving/{coordinates}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(url, params={"overview": "full", "geometries": "geojson"})
                response.raise_for_status()
                payload = response.json()
                line = payload["routes"][0]["geometry"]["coordinates"]
                return [Coordinate(lat=lat, lng=lng) for lng, lat in line]
        except Exception:
            pass
    return [Coordinate(lat=node.lat, lng=node.lng) for node in route_nodes]


async def build_mapbox_route_geometry(route_nodes: list[LocationPoint]) -> list[Coordinate] | None:
    if not MAPBOX_ACCESS_TOKEN or len(route_nodes) < 2 or len(route_nodes) > 25:
        return None

    coordinates = ";".join(f"{node.lng},{node.lat}" for node in route_nodes)
    url = f"https://api.mapbox.com/directions/v5/{MAPBOX_PROFILE}/{coordinates}"
    params = {
        "access_token": MAPBOX_ACCESS_TOKEN,
        "geometries": "geojson",
        "overview": "full",
    }
    if MAPBOX_PROFILE == "mapbox/driving-traffic":
        params["depart_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
            line = payload["routes"][0]["geometry"]["coordinates"]
            return [Coordinate(lat=lat, lng=lng) for lng, lat in line]
    except Exception:
        return None


async def build_google_route_geometry(route_nodes: list[LocationPoint]) -> list[Coordinate] | None:
    if not GOOGLE_MAPS_API_KEY or len(route_nodes) < 2:
        return None

    url = "https://routes.googleapis.com/directions/v2:computeRoutes"
    body = {
        "origin": google_waypoint(route_nodes[0]),
        "destination": google_waypoint(route_nodes[-1]),
        "intermediates": [google_waypoint(node) for node in route_nodes[1:-1]],
        "travelMode": "DRIVE",
        "routingPreference": GOOGLE_ROUTING_PREFERENCE,
        "departureTime": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "computeAlternativeRoutes": False,
        "polylineQuality": "HIGH_QUALITY",
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(url, json=body, headers=headers)
            response.raise_for_status()
            payload = response.json()
            encoded = payload["routes"][0]["polyline"]["encodedPolyline"]
            return decode_google_polyline(encoded)
    except Exception:
        return None


def active_routing_provider() -> str:
    if ROUTING_PROVIDER == "google" and GOOGLE_MAPS_API_KEY:
        return "google"
    if ROUTING_PROVIDER == "mapbox" and MAPBOX_ACCESS_TOKEN:
        return "mapbox"
    if OSRM_BASE_URL:
        return "osrm"
    return "simulated"


def active_routing_profile_is_traffic_aware() -> bool:
    if active_routing_provider() == "google":
        return True
    if active_routing_provider() == "mapbox":
        return MAPBOX_PROFILE == "mapbox/driving-traffic"
    return False


def google_waypoint(node: LocationPoint) -> dict:
    return {
        "location": {
            "latLng": {
                "latitude": node.lat,
                "longitude": node.lng,
            }
        }
    }


def parse_google_duration_seconds(value: str) -> float:
    match = re.fullmatch(r"(\d+(?:\.\d+)?)s", value or "")
    if not match:
        return 0
    return float(match.group(1))


def decode_google_polyline(encoded: str) -> list[Coordinate]:
    coordinates: list[Coordinate] = []
    index = 0
    lat = 0
    lng = 0

    while index < len(encoded):
        lat_delta, index = decode_polyline_value(encoded, index)
        lng_delta, index = decode_polyline_value(encoded, index)
        lat += lat_delta
        lng += lng_delta
        coordinates.append(Coordinate(lat=lat / 1e5, lng=lng / 1e5))

    return coordinates


def decode_polyline_value(encoded: str, index: int) -> tuple[int, int]:
    result = 0
    shift = 0

    while True:
        byte = ord(encoded[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break

    value = ~(result >> 1) if result & 1 else result >> 1
    return value, index


def haversine_km(origin: Coordinate, destination: Coordinate) -> float:
    radius = 6371
    d_lat = math.radians(destination.lat - origin.lat)
    d_lng = math.radians(destination.lng - origin.lng)
    lat1 = math.radians(origin.lat)
    lat2 = math.radians(destination.lat)
    value = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(value))


def time_to_minutes(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)
