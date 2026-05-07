import type { LocationPoint, Order, RoutePlan } from "@/types/vrp";

export type DriverStopPayload = {
  sequence: number;
  locationId: string;
  orderId?: string;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  arrivalMinutes: number;
  timeWindow?: string;
  serviceMinutes: number;
  loadKg: number;
  loadCbm: number;
  warnings: string[];
};

export type DriverRoutePayload = {
  version: 1;
  scenarioId: string;
  planningDate: string;
  generatedAt: string;
  vehicleId: string;
  vehicleName: string;
  color: string;
  distanceKm: number;
  durationMinutes: number;
  loadKg: number;
  loadCbm: number;
  stops: DriverStopPayload[];
};

export function minutesToClock(value: number) {
  const normalized = Math.max(0, Math.round(value));
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function encodeDriverPayload(payload: DriverRoutePayload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeDriverPayload(value: string): DriverRoutePayload | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as DriverRoutePayload;
  } catch {
    return null;
  }
}

export function buildDriverRoutePayload({
  route,
  locations,
  orders,
  planningDate,
  scenarioId
}: {
  route: RoutePlan;
  locations: LocationPoint[];
  orders: Order[];
  planningDate: string;
  scenarioId: string;
}): DriverRoutePayload {
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const orderById = new Map(orders.map((order) => [order.id, order]));
  let deliverySequence = 0;

  return {
    version: 1,
    scenarioId,
    planningDate,
    generatedAt: new Date().toISOString(),
    vehicleId: route.vehicleId,
    vehicleName: route.vehicleName,
    color: route.color,
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    loadKg: route.loadKg,
    loadCbm: route.loadCbm,
    stops: route.stops.map((stop) => {
      const order = stop.orderId ? orderById.get(stop.orderId) : undefined;
      const location = locationById.get(stop.locationId);
      if (stop.orderId) deliverySequence += 1;
      return {
        sequence: stop.orderId ? deliverySequence : 0,
        locationId: stop.locationId,
        orderId: stop.orderId,
        name: stop.name,
        address: location?.address,
        lat: stop.lat,
        lng: stop.lng,
        arrivalMinutes: stop.arrivalMinutes,
        timeWindow: order ? `${order.timeWindowStart}-${order.timeWindowEnd}` : undefined,
        serviceMinutes: stop.serviceMinutes,
        loadKg: stop.loadKg,
        loadCbm: stop.loadCbm,
        warnings: stop.warnings
      };
    })
  };
}
