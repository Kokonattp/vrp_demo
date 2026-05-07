import math
import os
import re
from datetime import datetime, timezone
from typing import Literal

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
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]


class Coordinate(BaseModel):
    lat: float
    lng: float


class LocationPoint(Coordinate):
    id: str
    name: str
    type: Literal["depot", "store"]
    address: str | None = None


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
    weightKg: float
    cbm: float
    serviceMinutes: int
    timeWindowStart: str
    timeWindowEnd: str
    priority: Literal["normal", "high"]


class OptimizeRequest(BaseModel):
    scenarioId: str
    depotId: str
    locations: list[LocationPoint]
    vehicles: list[Vehicle]
    orders: list[Order]


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
    geometry: list[Coordinate]


class ScenarioResult(BaseModel):
    scenarioId: str
    status: Literal["optimized", "fallback", "infeasible"]
    objective: float
    totalDistanceKm: float
    totalDurationMinutes: int
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
        "routingApi": bool(OSRM_BASE_URL or GOOGLE_MAPS_API_KEY),
        "trafficAware": active_routing_provider() == "google",
        "ortools": pywrapcp is not None,
    }


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

    distance_matrix, duration_matrix, routing_warning = await build_matrices(nodes)
    if pywrapcp is None:
        return build_greedy_result(request, nodes, node_orders, distance_matrix, duration_matrix, routing_warning)

    manager = pywrapcp.RoutingIndexManager(len(nodes), len(request.vehicles), [0] * len(request.vehicles), [0] * len(request.vehicles))
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return int(distance_matrix[from_node][to_node] * 1000)

    transit_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_index)

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
        if order:
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
        penalty = 250_000 if order and order.priority == "high" else 100_000
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


async def build_matrices(nodes: list[LocationPoint]) -> tuple[list[list[float]], list[list[int]], str | None]:
    if active_routing_provider() == "google":
        google_result = await build_google_matrices(nodes)
        if google_result:
            return google_result
        if not OSRM_BASE_URL:
            return build_simulated_matrices(nodes, "Google traffic routing unavailable; simulated travel matrix used.")

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
                if ROUTING_PROVIDER == "google":
                    warning = "Google traffic routing unavailable; OSRM road routing used without live traffic."
                return distances, durations, warning
        except Exception:
            pass

    return build_simulated_matrices(nodes, "Routing API unavailable; simulated travel matrix used.")


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


async def build_google_matrices(nodes: list[LocationPoint]) -> tuple[list[list[float]], list[list[int]], str | None] | None:
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
        "departureTime": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
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
                if arrival > time_to_minutes(order.timeWindowEnd):
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
        routes.append(
            RoutePlan(
                vehicleId=vehicle.id,
                vehicleName=vehicle.name,
                color=ROUTE_COLORS[vehicle_index % len(ROUTE_COLORS)],
                stops=stops,
                distanceKm=round(route_distance, 1),
                durationMinutes=route_duration + sum(stop.serviceMinutes for stop in stops),
                loadKg=round(load_kg, 1),
                loadCbm=round(load_cbm, 1),
                warnings=warnings,
                geometry=geometry,
            )
        )

    unassigned = [node_orders[index].id for index in range(1, len(nodes)) if index not in visited_nodes and node_orders[index]]
    warnings = [routing_warning] if routing_warning else []
    return ScenarioResult(
        scenarioId=request.scenarioId,
        status="optimized",
        objective=round(sum(route.distanceKm for route in routes), 1),
        totalDistanceKm=round(sum(route.distanceKm for route in routes), 1),
        totalDurationMinutes=sum(route.durationMinutes for route in routes),
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
    prioritized_orders = sorted(request.orders, key=lambda order: order.priority != "high")
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
                if elapsed < time_to_minutes(order.timeWindowStart):
                    elapsed = time_to_minutes(order.timeWindowStart)
                if elapsed > time_to_minutes(order.timeWindowEnd):
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
        routes.append(
            RoutePlan(
                vehicleId=vehicle.id,
                vehicleName=vehicle.name,
                color=ROUTE_COLORS[vehicle_index % len(ROUTE_COLORS)],
                stops=stops,
                distanceKm=round(route_distance, 1),
                durationMinutes=max(0, elapsed - 8 * 60),
                loadKg=round(load_kg, 1),
                loadCbm=round(load_cbm, 1),
                warnings=warnings,
                geometry=[Coordinate(lat=location.lat, lng=location.lng) for location in route_locations],
            )
        )

    warnings = [routing_warning or "OR-Tools unavailable; greedy fallback used."]
    return ScenarioResult(
        scenarioId=request.scenarioId,
        status="fallback",
        objective=round(sum(route.distanceKm for route in routes), 1),
        totalDistanceKm=round(sum(route.distanceKm for route in routes), 1),
        totalDurationMinutes=sum(route.durationMinutes for route in routes),
        unassignedOrders=unassigned,
        warnings=warnings,
        routes=routes,
    )


async def build_route_geometry(route_nodes: list[LocationPoint]) -> list[Coordinate]:
    if active_routing_provider() == "google" and len(route_nodes) > 1:
        google_geometry = await build_google_route_geometry(route_nodes)
        if google_geometry:
            return google_geometry

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
    if OSRM_BASE_URL:
        return "osrm"
    return "simulated"


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
