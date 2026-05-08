export type Coordinate = {
  lat: number;
  lng: number;
};

export type LocationPoint = Coordinate & {
  id: string;
  name: string;
  type: "depot" | "store";
  address?: string;
  clusterId?: string;
  clusterLocked?: boolean;
  preferredDays?: string[];
  preferredTimeWindow?: string;
  serviceFrequency?: "daily" | "weekly" | "biweekly" | "monthly";
  zoneHint?: string;
  vehicleRestriction?: string;
};

export type Vehicle = {
  id: string;
  name: string;
  capacityKg: number;
  capacityCbm: number;
  maxStops: number;
  startLocationId: string;
  endLocationId: string;
  restrictedZones: string[];
};

export type Order = {
  id: string;
  locationId: string;
  serviceDate: string;
  timeMode: "fixed" | "flexible";
  weightKg: number;
  cbm: number;
  serviceMinutes: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  priority: "normal" | "high";
};

export type CostModel = {
  vehicleFixedCost: number;
  costPerKm: number;
  costPerHour: number;
  overtimeCostPerHour: number;
  driverShiftMinutes: number;
  latePenaltyPerStop: number;
  unassignedPenaltyPerOrder: number;
};

export type RouteStop = {
  locationId: string;
  orderId?: string;
  name: string;
  lat: number;
  lng: number;
  arrivalMinutes: number;
  loadKg: number;
  loadCbm: number;
  serviceMinutes: number;
  warnings: string[];
};

export type RoutePlan = {
  vehicleId: string;
  vehicleName: string;
  color: string;
  stops: RouteStop[];
  distanceKm: number;
  durationMinutes: number;
  loadKg: number;
  loadCbm: number;
  warnings: string[];
  routeNotes: string[];
  fixedCost: number;
  distanceCost: number;
  timeCost: number;
  overtimeCost: number;
  latePenalty: number;
  totalCost: number;
  geometry: Coordinate[];
};

export type ScenarioResult = {
  scenarioId: string;
  status: "optimized" | "fallback" | "infeasible";
  objective: number;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  totalCost: number;
  costBreakdown: Record<string, number>;
  summary: string[];
  unassignedOrders: string[];
  warnings: string[];
  routes: RoutePlan[];
};

export type ClusterTemplate = {
  id: string;
  name: string;
  color: string;
  serviceDays: string[];
  branchIds: string[];
  anchorLocationId?: string;
  preferredVehicleType?: string;
  maxStops: number;
  notes: string[];
};

export type OptimizeRequest = {
  scenarioId: string;
  depotId: string;
  locations: LocationPoint[];
  vehicles: Vehicle[];
  orders: Order[];
  costModel: CostModel;
};
