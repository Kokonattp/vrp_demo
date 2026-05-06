import type { LocationPoint, Order, ScenarioResult, Vehicle } from "@/types/vrp";

export const routeColors = ["#047f8f", "#d97706", "#6d5dfc", "#0f766e", "#be123c"];

export const sampleLocations: LocationPoint[] = [
  {
    id: "depot-bkk",
    name: "Bangkok Distribution Hub",
    type: "depot",
    lat: 13.7563,
    lng: 100.5018,
    address: "Bangkok"
  },
  {
    id: "store-silom",
    name: "Silom Store",
    type: "store",
    lat: 13.7246,
    lng: 100.5347
  },
  {
    id: "store-ari",
    name: "Ari Store",
    type: "store",
    lat: 13.7801,
    lng: 100.5446
  },
  {
    id: "store-thonglor",
    name: "Thong Lo Store",
    type: "store",
    lat: 13.7307,
    lng: 100.5826
  },
  {
    id: "store-rama9",
    name: "Rama 9 Store",
    type: "store",
    lat: 13.7579,
    lng: 100.565
  },
  {
    id: "store-bangna",
    name: "Bang Na Store",
    type: "store",
    lat: 13.6682,
    lng: 100.6047
  }
];

export const sampleVehicles: Vehicle[] = [
  {
    id: "veh-1",
    name: "EV Van 01",
    capacityKg: 900,
    capacityCbm: 8,
    maxStops: 5,
    startLocationId: "depot-bkk",
    endLocationId: "depot-bkk",
    restrictedZones: ["low-emission-only"]
  },
  {
    id: "veh-2",
    name: "Box Truck 02",
    capacityKg: 1600,
    capacityCbm: 16,
    maxStops: 6,
    startLocationId: "depot-bkk",
    endLocationId: "depot-bkk",
    restrictedZones: []
  }
];

export const sampleOrders: Order[] = [
  {
    id: "ord-1001",
    locationId: "store-silom",
    weightKg: 180,
    cbm: 1.2,
    serviceMinutes: 18,
    timeWindowStart: "09:00",
    timeWindowEnd: "11:30",
    priority: "high"
  },
  {
    id: "ord-1002",
    locationId: "store-ari",
    weightKg: 240,
    cbm: 1.6,
    serviceMinutes: 20,
    timeWindowStart: "10:00",
    timeWindowEnd: "14:30",
    priority: "normal"
  },
  {
    id: "ord-1003",
    locationId: "store-thonglor",
    weightKg: 320,
    cbm: 2.4,
    serviceMinutes: 25,
    timeWindowStart: "13:00",
    timeWindowEnd: "17:00",
    priority: "normal"
  },
  {
    id: "ord-1004",
    locationId: "store-rama9",
    weightKg: 210,
    cbm: 1.3,
    serviceMinutes: 16,
    timeWindowStart: "09:30",
    timeWindowEnd: "15:00",
    priority: "high"
  },
  {
    id: "ord-1005",
    locationId: "store-bangna",
    weightKg: 520,
    cbm: 3.1,
    serviceMinutes: 30,
    timeWindowStart: "11:00",
    timeWindowEnd: "16:30",
    priority: "normal"
  }
];

export const initialScenarioComparison: ScenarioResult[] = [
  {
    scenarioId: "baseline",
    status: "optimized",
    objective: 0,
    totalDistanceKm: 58.4,
    totalDurationMinutes: 212,
    unassignedOrders: [],
    warnings: ["Baseline uses haversine estimates until routing API responds."],
    routes: []
  },
  {
    scenarioId: "small-fleet",
    status: "fallback",
    objective: 0,
    totalDistanceKm: 64.7,
    totalDurationMinutes: 248,
    unassignedOrders: ["ord-1005"],
    warnings: ["One order exceeds remaining capacity in the reduced fleet."],
    routes: []
  }
];
