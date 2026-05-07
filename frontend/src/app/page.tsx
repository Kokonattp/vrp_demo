"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  Boxes,
  Calculator,
  CircleHelp,
  Clock3,
  Download,
  FileUp,
  Play,
  Plus,
  Printer,
  QrCode,
  Route,
  Smartphone,
  Truck,
  Upload,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import QRCode from "qrcode";
import { buildDriverRoutePayload, encodeDriverPayload, minutesToClock, type DriverRoutePayload } from "@/lib/driver-payload";
import { initialScenarioComparison, routeColors, sampleLocations, sampleOrders, sampleVehicles } from "@/lib/sample-data";
import type { Coordinate, CostModel, LocationPoint, OptimizeRequest, Order, RoutePlan, RouteStop, ScenarioResult, Vehicle } from "@/types/vrp";

const VrpMap = dynamic(() => import("@/components/vrp-map").then((mod) => mod.VrpMap), { ssr: false });

const API_URL = "";

const defaultCostModel: CostModel = {
  vehicleFixedCost: 1200,
  costPerKm: 12,
  costPerHour: 180,
  overtimeCostPerHour: 250,
  driverShiftMinutes: 480,
  latePenaltyPerStop: 500,
  unassignedPenaltyPerOrder: 2000
};

function todayDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildBranchCsvTemplate(baseDate: string) {
  return [
    "id,name,lat,lng,address,serviceDate,demandKg,cbm,serviceMinutes,timeMode,timeWindowStart,timeWindowEnd,priority",
    `depot-bkk,ศูนย์กระจายสินค้ากรุงเทพ,13.7563,100.5018,กรุงเทพมหานคร,${baseDate},,,,,,,`,
    `store-silom,สาขาสีลม,13.7246,100.5347,สีลม,${baseDate},180,1.2,18,flexible,,,high`,
    `store-silom,สาขาสีลม,13.7246,100.5347,สีลม,${addDays(baseDate, 1)},260,1.8,22,flexible,,,normal`,
    `store-rama9,สาขาพระราม 9,13.7579,100.5650,พระราม 9,${baseDate},210,1.3,16,fixed,09:00,09:30,high`,
    `store-ari,สาขาอารีย์,13.7801,100.5446,พญาไท,${baseDate},240,1.6,20,flexible,,,normal`
  ].join("\n");
}

const panels = [
  { id: "upload", label: "พิกัดสาขา", icon: FileUp },
  { id: "vehicles", label: "รถจำลอง", icon: Truck },
  { id: "run", label: "ออเดอร์และคำนวณ", icon: Play }
] as const;

type OptimizerState = "warming" | "ready" | "traffic" | "offline";

function statusLabel(value: ScenarioResult["status"] | OptimizerState) {
  const labels = {
    optimized: "คำนวณแล้ว",
    fallback: "ประมาณการ",
    infeasible: "จัดไม่ได้",
    warming: "กำลังปลุก",
    ready: "พร้อมใช้",
    traffic: "จราจรจริง",
    offline: "ออฟไลน์"
  };
  return labels[value];
}

function locationTypeLabel(type: LocationPoint["type"]) {
  return type === "depot" ? "คลัง" : "สาขา";
}

function priorityLabel(priority: Order["priority"]) {
  return priority === "high" ? "ด่วน" : "ปกติ";
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const normalized = Math.max(0, Math.round(value));
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatCurrency(value: number | undefined) {
  return `${Math.round(value ?? 0).toLocaleString("th-TH")} บาท`;
}

type DisplayRouteStop = RouteStop & {
  deliveryCount: number;
  orderIds: string[];
};

function compactRouteStops(stops: RouteStop[]): DisplayRouteStop[] {
  return stops.reduce<DisplayRouteStop[]>((compact, stop) => {
    const previous = compact[compact.length - 1];
    const isDepot = stop.locationId === stops[0]?.locationId && !stop.orderId;
    const canMerge =
      previous &&
      !isDepot &&
      previous.locationId === stop.locationId &&
      (previous.orderIds.length > 0 || Boolean(stop.orderId));

    if (canMerge) {
      previous.deliveryCount += stop.orderId ? 1 : 0;
      if (stop.orderId) previous.orderIds.push(stop.orderId);
      previous.serviceMinutes += stop.serviceMinutes;
      previous.warnings = [...previous.warnings, ...stop.warnings];
      return compact;
    }

    compact.push({
      ...stop,
      deliveryCount: stop.orderId ? 1 : 0,
      orderIds: stop.orderId ? [stop.orderId] : []
    });
    return compact;
  }, []);
}

function distanceKm(a: Coordinate, b: Coordinate) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function calculateRouteCost(
  distanceKmValue: number,
  durationMinutes: number,
  lateStopCount: number,
  costModel: CostModel
) {
  const fixedCost = Math.max(0, costModel.vehicleFixedCost);
  const distanceCost = Math.max(0, distanceKmValue) * Math.max(0, costModel.costPerKm);
  const timeCost = (Math.max(0, durationMinutes) / 60) * Math.max(0, costModel.costPerHour);
  const overtimeMinutes = Math.max(0, durationMinutes - Math.max(0, costModel.driverShiftMinutes));
  const overtimeCost = (overtimeMinutes / 60) * Math.max(0, costModel.overtimeCostPerHour);
  const latePenalty = Math.max(0, lateStopCount) * Math.max(0, costModel.latePenaltyPerStop);
  const totalCost = fixedCost + distanceCost + timeCost + overtimeCost + latePenalty;
  return {
    fixedCost: Number(fixedCost.toFixed(2)),
    distanceCost: Number(distanceCost.toFixed(2)),
    timeCost: Number(timeCost.toFixed(2)),
    overtimeCost: Number(overtimeCost.toFixed(2)),
    latePenalty: Number(latePenalty.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2))
  };
}

function buildCostBreakdown(routes: RoutePlan[], unassignedOrders: string[], costModel: CostModel) {
  const unassignedPenalty = unassignedOrders.length * Math.max(0, costModel.unassignedPenaltyPerOrder);
  return {
    fixedCost: Number(routes.reduce((sum, route) => sum + (route.fixedCost ?? 0), 0).toFixed(2)),
    distanceCost: Number(routes.reduce((sum, route) => sum + (route.distanceCost ?? 0), 0).toFixed(2)),
    timeCost: Number(routes.reduce((sum, route) => sum + (route.timeCost ?? 0), 0).toFixed(2)),
    overtimeCost: Number(routes.reduce((sum, route) => sum + (route.overtimeCost ?? 0), 0).toFixed(2)),
    latePenalty: Number(routes.reduce((sum, route) => sum + (route.latePenalty ?? 0), 0).toFixed(2)),
    unassignedPenalty: Number(unassignedPenalty.toFixed(2)),
    totalCost: Number((routes.reduce((sum, route) => sum + (route.totalCost ?? 0), 0) + unassignedPenalty).toFixed(2))
  };
}

function buildScenarioSummary(
  status: ScenarioResult["status"],
  routes: RoutePlan[],
  unassignedOrders: string[],
  warnings: string[],
  costBreakdown: Record<string, number>
) {
  if (!routes.length) return ["ยังไม่มีเส้นทางที่จัดได้จากข้อมูลชุดนี้"];
  const orderCount = routes.reduce((sum, route) => sum + route.stops.filter((stop) => stop.orderId).length, 0);
  const totalDistance = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  const totalDuration = routes.reduce((sum, route) => sum + route.durationMinutes, 0);
  const summary = [
    `ใช้รถ ${routes.length} คัน จัดส่ง ${orderCount} ออเดอร์ ระยะทางรวม ${totalDistance.toFixed(1)} กม. ใช้เวลารวม ${totalDuration} นาที`,
    `ต้นทุนจำลองรวม ${formatCurrency(costBreakdown.totalCost)} จากค่ารถ ระยะทาง เวลา OT และ penalty`
  ];
  if (status === "fallback") summary.push("ผลลัพธ์นี้เป็น fallback ในเครื่อง ใช้สำหรับทดลองเมื่อ backend/routing API ยังติดต่อไม่ได้");
  if (unassignedOrders.length) summary.push(`มีออเดอร์ยังไม่ถูกจัด ${unassignedOrders.length} รายการ`);
  if (warnings.length) summary.push(`มีข้อเตือน ${warnings.length} รายการ เช่น ${warnings[0]}`);
  return summary;
}

function buildLocalFallback(
  scenarioId: string,
  depotId: string,
  locations: LocationPoint[],
  vehicles: Vehicle[],
  orders: Order[],
  costModel: CostModel
): ScenarioResult {
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const depot = locationById.get(depotId) ?? locations[0];
  const unassignedOrders: string[] = [];
  const vehicleBuckets = vehicles.map((vehicle) => ({
    vehicle,
    orders: [] as Order[],
    loadKg: 0,
    loadCbm: 0
  }));

  sortOrdersForAnchorClustering(orders, locations).forEach((order) => {
    const bucket = vehicleBuckets.find(
      (candidate) =>
        candidate.orders.length < candidate.vehicle.maxStops &&
        candidate.loadKg + order.weightKg <= candidate.vehicle.capacityKg &&
        candidate.loadCbm + order.cbm <= candidate.vehicle.capacityCbm
    );
    if (!bucket) {
      unassignedOrders.push(order.id);
      return;
    }
    bucket.orders.push(order);
    bucket.loadKg += order.weightKg;
    bucket.loadCbm += order.cbm;
  });

  const routes = vehicleBuckets
    .filter((bucket) => bucket.orders.length)
    .map((bucket, index) => {
      let cursor: Coordinate = depot;
      let elapsed = 8 * 60;
      let routeDistance = 0;
      const stops: RouteStop[] = [
        {
          locationId: depot.id,
          name: depot.name,
          lat: depot.lat,
          lng: depot.lng,
          arrivalMinutes: elapsed,
          loadKg: 0,
          loadCbm: 0,
          serviceMinutes: 0,
          warnings: []
        }
      ];
      const warnings: string[] = [];

      bucket.orders.forEach((order) => {
        const location = locationById.get(order.locationId);
        if (!location) return;
        const legDistance = distanceKm(cursor, location);
        const travelMinutes = (legDistance / 32) * 60;
        routeDistance += legDistance;
        elapsed += travelMinutes;
        const stopWarnings: string[] = [];
        if (order.timeMode === "fixed" && elapsed < timeToMinutes(order.timeWindowStart)) {
          elapsed = timeToMinutes(order.timeWindowStart);
        }
        if (order.timeMode === "fixed" && elapsed > timeToMinutes(order.timeWindowEnd)) {
          stopWarnings.push("เกินช่วงเวลา");
          warnings.push(`${order.id} เกินเวลาส่ง ${order.timeWindowEnd}`);
        }
        stops.push({
          locationId: location.id,
          orderId: order.id,
          name: location.name,
          lat: location.lat,
          lng: location.lng,
          arrivalMinutes: elapsed,
          loadKg: order.weightKg,
          loadCbm: order.cbm,
          serviceMinutes: order.serviceMinutes,
          warnings: stopWarnings
        });
        elapsed += order.serviceMinutes;
        cursor = location;
      });

      routeDistance += distanceKm(cursor, depot);
      elapsed += (distanceKm(cursor, depot) / 32) * 60;
      stops.push({
        locationId: depot.id,
        name: depot.name,
        lat: depot.lat,
        lng: depot.lng,
        arrivalMinutes: elapsed,
        loadKg: bucket.loadKg,
        loadCbm: bucket.loadCbm,
        serviceMinutes: 0,
        warnings: []
      });
      const routeDuration = Math.round(elapsed - 8 * 60);
      const lateStopCount = stops.reduce(
        (sum, stop) => sum + stop.warnings.filter((warning) => warning.includes("เวลา") || warning.includes("Time window")).length,
        0
      );
      const routeCost = calculateRouteCost(routeDistance, routeDuration, lateStopCount, costModel);

      return {
        vehicleId: bucket.vehicle.id,
        vehicleName: bucket.vehicle.name,
        color: routeColors[index % routeColors.length],
        stops,
        distanceKm: Number(routeDistance.toFixed(1)),
        durationMinutes: routeDuration,
        loadKg: bucket.loadKg,
        loadCbm: Number(bucket.loadCbm.toFixed(1)),
        warnings,
        routeNotes: buildLocalRouteNotes(bucket.orders, locations),
        fixedCost: routeCost.fixedCost,
        distanceCost: routeCost.distanceCost,
        timeCost: routeCost.timeCost,
        overtimeCost: routeCost.overtimeCost,
        latePenalty: routeCost.latePenalty,
        totalCost: routeCost.totalCost,
        geometry: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
      };
    });

  const fallbackWarnings = ["ใช้แผนประมาณการในเครื่อง เพราะยังติดต่อ backend OR-Tools ไม่สำเร็จ"];
  const costBreakdown = buildCostBreakdown(routes, unassignedOrders, costModel);

  return {
    scenarioId,
    status: "fallback",
    objective: costBreakdown.totalCost,
    totalDistanceKm: Number(routes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1)),
    totalDurationMinutes: routes.reduce((sum, route) => sum + route.durationMinutes, 0),
    totalCost: costBreakdown.totalCost,
    costBreakdown,
    summary: buildScenarioSummary("fallback", routes, unassignedOrders, fallbackWarnings, costBreakdown),
    unassignedOrders,
    warnings: fallbackWarnings,
    routes
  };
}

function sortOrdersForAnchorClustering(orders: Order[], locations: LocationPoint[]) {
  const fixedOrders = orders.filter((order) => order.timeMode === "fixed" && order.timeWindowStart && order.timeWindowEnd);
  const locationById = new Map(locations.map((location) => [location.id, location]));

  return [...orders].sort((a, b) => {
    const aKey = anchorSortKey(a, fixedOrders, locationById);
    const bKey = anchorSortKey(b, fixedOrders, locationById);
    return aKey[0] - bKey[0] || aKey[1] - bKey[1] || aKey[2] - bKey[2] || a.id.localeCompare(b.id);
  });
}

function anchorSortKey(order: Order, fixedOrders: Order[], locationById: Map<string, LocationPoint>): [number, number, number] {
  if (order.timeMode === "fixed" && order.timeWindowStart) {
    return [0, timeToMinutes(order.timeWindowStart), 0];
  }
  if (fixedOrders.length) {
    const nearest = fixedOrders.reduce(
      (best, fixed) => {
        const distance = distanceBetweenLocations(order.locationId, fixed.locationId, locationById);
        return distance < best.distance ? { fixed, distance } : best;
      },
      { fixed: fixedOrders[0], distance: Number.POSITIVE_INFINITY }
    );
    return [1, timeToMinutes(nearest.fixed.timeWindowStart), Math.round(nearest.distance * 10)];
  }
  return [2, order.priority === "high" ? 0 : 1, 0];
}

function distanceBetweenLocations(leftId: string, rightId: string, locationById: Map<string, LocationPoint>) {
  const left = locationById.get(leftId);
  const right = locationById.get(rightId);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return distanceKm(left, right);
}

function buildLocalRouteNotes(orders: Order[], locations: LocationPoint[]) {
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const notes: string[] = [];
  orders.forEach((order) => {
    if (order.timeMode !== "flexible") return;
    const fixedOrders = orders.filter((candidate) => candidate.timeMode === "fixed" && candidate.timeWindowStart);
    if (!fixedOrders.length) return;
    const nearest = fixedOrders.reduce(
      (best, fixed) => {
        const distance = distanceBetweenLocations(order.locationId, fixed.locationId, locationById);
        return distance < best.distance ? { fixed, distance } : best;
      },
      { fixed: fixedOrders[0], distance: Number.POSITIVE_INFINITY }
    );
    const location = locationById.get(order.locationId);
    const anchor = locationById.get(nearest.fixed.locationId);
    if (location && anchor && nearest.distance <= 6) {
      notes.push(`${location.name} ถูกจัดใกล้ ${anchor.name} เพราะเป็นจุดยืดหยุ่นใกล้ anchor เวลา ${nearest.fixed.timeWindowStart}.`);
    }
  });
  return notes.slice(0, 3);
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBranchCsv(csv: string): { locations: LocationPoint[]; orders: Order[] } {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasHeader = rows[0]?.toLowerCase().startsWith("id,");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const locations: LocationPoint[] = [];
  const orders: Order[] = [];

  dataRows.forEach((line, index) => {
    const cells = line
      .split(",")
      .map((cell) => cell.trim());
    const [id, name, lat, lng, address] = cells;
    const hasServiceDate = /^\d{4}-\d{2}-\d{2}$/.test(cells[5] ?? "");
    const serviceDate = hasServiceDate ? cells[5] : todayDate();
    const values = hasServiceDate ? cells.slice(6, 13) : cells.slice(5, 12);
    const [demandKg, cbm, serviceMinutes, timeModeCell, timeWindowStart, timeWindowEnd, priority] = values;
    const timeMode: Order["timeMode"] =
      timeModeCell === "fixed" || (timeWindowStart && timeWindowEnd) ? "fixed" : "flexible";
    const type: LocationPoint["type"] = index === 0 && (id || "").toLowerCase().includes("depot") ? "depot" : "store";
    const location: LocationPoint = {
        id: id || `store-${index + 1}`,
        name: name || `สาขา ${index + 1}`,
        type,
        lat: Number(lat),
        lng: Number(lng),
        address
    };
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;
    const existingLocation = locations.find((item) => item.id === location.id);
    if (existingLocation) {
      Object.assign(existingLocation, location);
    } else {
      locations.push(location);
    }

    if (type === "store") {
      orders.push({
        id: `ord-${serviceDate}-${location.id.replace(/[^a-zA-Z0-9-]/g, "-")}`,
        locationId: location.id,
        serviceDate,
        timeMode,
        weightKg: parseNumber(demandKg, 120),
        cbm: parseNumber(cbm, 1),
        serviceMinutes: parseNumber(serviceMinutes, 15),
        timeWindowStart: timeMode === "fixed" ? timeWindowStart || "09:00" : "",
        timeWindowEnd: timeMode === "fixed" ? timeWindowEnd || "17:00" : "",
        priority: priority === "high" ? "high" : "normal"
      });
    }
  });

  return { locations, orders };
}

function emptyScenarioResult(scenarioId: string): ScenarioResult {
  return {
    scenarioId,
    status: "fallback",
    objective: 0,
    totalDistanceKm: 0,
    totalDurationMinutes: 0,
    totalCost: 0,
    costBreakdown: {},
    summary: [],
    unassignedOrders: [],
    warnings: [],
    routes: []
  };
}

export default function Home() {
  const [activePanel, setActivePanel] = useState<(typeof panels)[number]["id"]>("upload");
  const [locations, setLocations] = useState<LocationPoint[]>(sampleLocations);
  const [vehicles, setVehicles] = useState<Vehicle[]>(sampleVehicles);
  const [orders, setOrders] = useState<Order[]>(sampleOrders);
  const [costModel, setCostModel] = useState<CostModel>(defaultCostModel);
  const [result, setResult] = useState<ScenarioResult>(() => emptyScenarioResult("baseline"));
  const [comparison, setComparison] = useState<ScenarioResult[]>(initialScenarioComparison);
  const [planningDate, setPlanningDate] = useState(() => todayDate());
  const csvTemplate = useMemo(() => buildBranchCsvTemplate(planningDate), [planningDate]);
  const [csvText, setCsvText] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("depot-bkk");
  const [isRunning, setIsRunning] = useState(false);
  const [optimizerState, setOptimizerState] = useState<OptimizerState>("warming");
  const [scenarioName, setScenarioName] = useState("morning-wave");
  const [showGuide, setShowGuide] = useState(false);
  const [hasCalculatedRoute, setHasCalculatedRoute] = useState(false);
  const [driverAssets, setDriverAssets] = useState<Record<string, { url: string; qr: string }>>({});

  const depot = useMemo(() => locations.find((location) => location.type === "depot") ?? locations[0], [locations]);
  const dailyOrders = useMemo(
    () => orders.filter((order) => order.serviceDate === planningDate),
    [orders, planningDate]
  );
  const totalDemand = useMemo(
    () =>
      dailyOrders.reduce(
        (sum, order) => ({
          kg: sum.kg + order.weightKg,
          cbm: sum.cbm + order.cbm
        }),
        { kg: 0, cbm: 0 }
      ),
    [dailyOrders]
  );
  const totalCapacity = useMemo(
    () =>
      vehicles.reduce(
        (sum, vehicle) => ({
          kg: sum.kg + vehicle.capacityKg,
          cbm: sum.cbm + vehicle.capacityCbm
        }),
        { kg: 0, cbm: 0 }
      ),
    [vehicles]
  );
  const allWarnings = useMemo(
    () => [...result.warnings, ...result.routes.flatMap((route) => route.warnings), ...result.unassignedOrders.map((id) => `${id} ยังไม่ถูกจัดส่ง`)],
    [result]
  );
  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedLocationId) ?? locations[0],
    [locations, selectedLocationId]
  );
  const selectedBranchOrder = useMemo(
    () => orders.find((order) => order.locationId === selectedLocation?.id && order.serviceDate === planningDate),
    [orders, planningDate, selectedLocation?.id]
  );
  const driverPayloads = useMemo(
    () =>
      result.routes.map((route) =>
        buildDriverRoutePayload({
          route,
          locations,
          orders: dailyOrders,
          planningDate,
          scenarioId: result.scenarioId
        })
      ),
    [dailyOrders, locations, planningDate, result.routes, result.scenarioId]
  );

  useEffect(() => {
    let isActive = true;
    if (!driverPayloads.length) {
      const timer = window.setTimeout(() => setDriverAssets({}), 0);
      return () => {
        isActive = false;
        window.clearTimeout(timer);
      };
    }

    Promise.all(
      driverPayloads.map(async (payload) => {
        const encoded = encodeDriverPayload(payload);
        const url = `${window.location.origin}/driver#data=${encoded}`;
        const qr = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
          color: {
            dark: "#1B2E4B",
            light: "#FFFFFF"
          }
        });
        return [payload.vehicleId, { url, qr }] as const;
      })
    ).then((entries) => {
      if (isActive) setDriverAssets(Object.fromEntries(entries));
    });

    return () => {
      isActive = false;
    };
  }, [driverPayloads]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);

    fetch(`${API_URL}/api/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          setOptimizerState("offline");
          return;
        }
        const health = (await response.json()) as { trafficAware?: boolean; routingProvider?: string };
        setOptimizerState(health.trafficAware || health.routingProvider === "google" || health.routingProvider === "mapbox" ? "traffic" : "ready");
      })
      .catch(() => setOptimizerState("offline"))
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const updateLocation = useCallback((id: string, coordinate: Coordinate) => {
    setLocations((current) =>
      current.map((location) => (location.id === id ? { ...location, lat: coordinate.lat, lng: coordinate.lng } : location))
    );
    setResult((current) => emptyScenarioResult(current.scenarioId));
    setHasCalculatedRoute(false);
  }, []);

  const runOptimization = useCallback(async (options?: { keepPanel?: boolean }) => {
    if (!depot) return;
    setIsRunning(true);
    setOptimizerState((current) => (current === "ready" ? current : "warming"));
    const payload: OptimizeRequest = {
      scenarioId: scenarioName || `scenario-${Date.now()}`,
      depotId: depot.id,
      locations,
      vehicles,
      orders: dailyOrders,
      costModel
    };

    try {
      const response = await fetch(`${API_URL}/api/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Optimizer returned ${response.status}`);
      const optimized = (await response.json()) as ScenarioResult;
      setOptimizerState((current) => (current === "traffic" ? "traffic" : "ready"));
      setResult(optimized);
      setHasCalculatedRoute(true);
      setComparison((current) => [optimized, ...current.filter((item) => item.scenarioId !== optimized.scenarioId)].slice(0, 4));
    } catch {
      setOptimizerState("offline");
      const fallback = buildLocalFallback(payload.scenarioId, payload.depotId, payload.locations, payload.vehicles, payload.orders, payload.costModel);
      setResult(fallback);
      setHasCalculatedRoute(true);
      setComparison((current) => [fallback, ...current.filter((item) => item.scenarioId !== fallback.scenarioId)].slice(0, 4));
    } finally {
      setIsRunning(false);
      if (!options?.keepPanel) {
        setActivePanel("run");
      }
    }
  }, [costModel, dailyOrders, depot, locations, scenarioName, vehicles]);

  const addVehicle = () => {
    if (!depot) return;
    setResult(emptyScenarioResult(scenarioName || "draft"));
    setHasCalculatedRoute(false);
    setVehicles((current) => [
      ...current,
      {
        id: `veh-${current.length + 1}`,
        name: `รถจำลอง ${current.length + 1}`,
        capacityKg: 1000,
        capacityCbm: 10,
        maxStops: 6,
        startLocationId: depot.id,
        endLocationId: depot.id,
        restrictedZones: []
      }
    ]);
  };

  const addOrder = () => {
    const store = locations.find((location) => location.type === "store");
    if (!store) return;
    setResult(emptyScenarioResult(scenarioName || "draft"));
    setHasCalculatedRoute(false);
    setOrders((current) => [
      ...current,
      {
        id: `ord-${1000 + current.length + 1}`,
        locationId: store.id,
        serviceDate: planningDate,
        timeMode: "flexible",
        weightKg: 120,
        cbm: 1,
        serviceMinutes: 15,
        timeWindowStart: "",
        timeWindowEnd: "",
        priority: "normal"
      }
    ]);
  };

  const importCsv = () => {
    const parsed = parseBranchCsv(csvText);
    if (!parsed.locations.length) return;
    const hasDepot = parsed.locations.some((location) => location.type === "depot");
    const nextLocations = hasDepot ? parsed.locations : [{ ...parsed.locations[0], type: "depot" as const }, ...parsed.locations.slice(1)];
    setLocations(nextLocations);
    setOrders(parsed.orders);
    setSelectedLocationId(nextLocations[0].id);
    setResult(emptyScenarioResult(scenarioName || "draft"));
    setHasCalculatedRoute(false);
  };

  const downloadCsvTemplate = () => {
    const blob = new Blob([csvTemplate], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vrp-branch-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const printWorkOrders = () => {
    window.print();
  };

  const importCsvFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setCsvText(text));
  };

  const addBranch = () => {
    const nextIndex = locations.filter((location) => location.type === "store").length + 1;
    const depotLocation = depot ?? locations[0];
    const nextLocation: LocationPoint = {
      id: `store-${nextIndex}`,
      name: `สาขาใหม่ ${nextIndex}`,
      type: "store",
      lat: (depotLocation?.lat ?? 13.7563) + nextIndex * 0.006,
      lng: (depotLocation?.lng ?? 100.5018) + nextIndex * 0.006,
      address: ""
    };
    const nextOrder: Order = {
      id: `ord-${planningDate}-${nextLocation.id}`,
      locationId: nextLocation.id,
      serviceDate: planningDate,
      timeMode: "flexible",
      weightKg: 120,
      cbm: 1,
      serviceMinutes: 15,
      timeWindowStart: "",
      timeWindowEnd: "",
      priority: "normal"
    };
    setLocations((current) => [...current, nextLocation]);
    setOrders((current) => [...current, nextOrder]);
    setSelectedLocationId(nextLocation.id);
    setResult(emptyScenarioResult(scenarioName || "draft"));
    setHasCalculatedRoute(false);
  };

  const updateSelectedLocation = (patch: Partial<LocationPoint>) => {
    if (!selectedLocation) return;
    setLocations((current) => current.map((location) => (location.id === selectedLocation.id ? { ...location, ...patch } : location)));
    setResult(emptyScenarioResult(scenarioName || "draft"));
    setHasCalculatedRoute(false);
  };

  const updateSelectedBranchOrder = (patch: Partial<Order>) => {
    if (!selectedLocation || selectedLocation.type === "depot") return;
    const baseOrder: Order = selectedBranchOrder ?? {
      id: `ord-${planningDate}-${selectedLocation.id}`,
      locationId: selectedLocation.id,
      serviceDate: planningDate,
      timeMode: "flexible",
      weightKg: 120,
      cbm: 1,
      serviceMinutes: 15,
      timeWindowStart: "",
      timeWindowEnd: "",
      priority: "normal"
    };
    const nextOrder = { ...baseOrder, ...patch };
    setOrders((current) =>
      current.some((order) => order.id === nextOrder.id)
        ? current.map((order) => (order.id === nextOrder.id ? nextOrder : order))
        : [...current, nextOrder]
    );
    setResult(emptyScenarioResult(scenarioName || "draft"));
    setHasCalculatedRoute(false);
  };

  const moveStopToRoute = (event: DragEvent<HTMLDivElement>, toVehicleId: string) => {
    const orderId = event.dataTransfer.getData("text/order-id");
    if (!orderId || !depot) return;
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return;
    const nextRoutes = result.routes.map((route) => {
      const orderStops = route.stops.filter((stop) => stop.orderId && stop.orderId !== orderId);
      if (route.vehicleId === toVehicleId) {
        const location = locations.find((candidate) => candidate.id === order.locationId);
        if (location) {
          orderStops.push({
            locationId: location.id,
            orderId: order.id,
            name: location.name,
            lat: location.lat,
            lng: location.lng,
            arrivalMinutes: 9 * 60 + orderStops.length * 35,
            loadKg: order.weightKg,
            loadCbm: order.cbm,
            serviceMinutes: order.serviceMinutes,
            warnings: []
          });
        }
      }

      const vehicle = vehicles.find((candidate) => candidate.id === route.vehicleId);
      const depotStop = {
        locationId: depot.id,
        name: depot.name,
        lat: depot.lat,
        lng: depot.lng,
        arrivalMinutes: 8 * 60,
        loadKg: 0,
        loadCbm: 0,
        serviceMinutes: 0,
        warnings: []
      };
      const stops: RouteStop[] = [depotStop, ...orderStops, { ...depotStop, arrivalMinutes: 18 * 60 }];
      const loadKg = orderStops.reduce((sum, stop) => sum + stop.loadKg, 0);
      const loadCbm = orderStops.reduce((sum, stop) => sum + stop.loadCbm, 0);
      const warnings = [
        ...(vehicle && loadKg > vehicle.capacityKg ? [`${vehicle.name} น้ำหนักเกินความจุ`] : []),
        ...(vehicle && loadCbm > vehicle.capacityCbm ? [`${vehicle.name} ปริมาตรเกินความจุ`] : []),
        ...(vehicle && orderStops.length > vehicle.maxStops ? [`${vehicle.name} จำนวนจุดส่งเกินกำหนด`] : [])
      ];
      const routeDistance = stops.slice(1).reduce((sum, stop, index) => sum + distanceKm(stops[index], stop), 0);
      const durationMinutes = Math.round((routeDistance / 28) * 60 + orderStops.reduce((sum, stop) => sum + stop.serviceMinutes, 0));
      const routeCost = calculateRouteCost(
        routeDistance,
        durationMinutes,
        stops.reduce((sum, stop) => sum + stop.warnings.filter((warning) => warning.includes("เวลา") || warning.includes("Time window")).length, 0),
        costModel
      );
      return {
        ...route,
        stops,
        geometry: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        loadKg,
        loadCbm,
        distanceKm: Number(routeDistance.toFixed(1)),
        durationMinutes,
        warnings,
        routeNotes: route.routeNotes ?? [],
        fixedCost: routeCost.fixedCost,
        distanceCost: routeCost.distanceCost,
        timeCost: routeCost.timeCost,
        overtimeCost: routeCost.overtimeCost,
        latePenalty: routeCost.latePenalty,
        totalCost: routeCost.totalCost
      };
    });
    const manualWarnings = ["มีการปรับเส้นทางด้วยมือ ควรคำนวณ VRP ใหม่เพื่อจัดลำดับจุดส่งอีกครั้ง"];
    setResult((current) => {
      const costBreakdown = buildCostBreakdown(nextRoutes, current.unassignedOrders, costModel);
      return {
        ...current,
        status: "fallback",
        routes: nextRoutes,
        totalDistanceKm: Number(nextRoutes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1)),
        totalDurationMinutes: nextRoutes.reduce((sum, route) => sum + route.durationMinutes, 0),
        totalCost: costBreakdown.totalCost,
        costBreakdown,
        summary: buildScenarioSummary("fallback", nextRoutes, current.unassignedOrders, manualWarnings, costBreakdown),
        warnings: manualWarnings
      };
    });
  };

  return (
    <>
    <main className="app-shell h-screen overflow-hidden bg-[#F8FAFC]">
      {showGuide && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
          <div className="w-full max-w-xl rounded-[14px] border border-border bg-white shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div>
                <Badge variant="success">คู่มือเร็ว</Badge>
                <h2 className="mt-3 text-xl font-semibold">VRP Simulation Studio ทำงานยังไง?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  ใช้แผนที่และพิกัดจริง แต่รถ ออเดอร์ น้ำหนัก CBM และข้อจำกัดเป็นข้อมูลจำลองสำหรับลองวางแผน
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowGuide(false)} aria-label="ปิดคู่มือ">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-3 p-5">
              {[
                ["1", "ใส่พิกัดจริง", "นำเข้า CSV หรือกรอกพิกัดสาขา/คลังด้วย lat, lng จริง"],
                ["2", "สร้างข้อมูลจำลอง", "กำหนดรถ ความจุ ออเดอร์ น้ำหนัก CBM เวลาเข้ารับ/ส่ง และ service time"],
                ["3", "กดคำนวณ VRP", "ระบบส่งข้อมูลไป backend OR-Tools เพื่อแบ่งงานให้รถและจัดลำดับจุดส่ง"]
              ].map(([number, title, detail]) => (
                <div key={number} className="flex gap-3 rounded-[14px] border border-border bg-[#F8FAFC] p-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                    {number}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                ถ้าสาขาเดียวมีหลายออเดอร์ ระบบจะแสดงเป็นจุดเดียวพร้อมจำนวนออเดอร์ เช่น “Silom Store · 4 ออเดอร์”
                เพื่อไม่ให้ดูเหมือนรถวนที่เดิมหลายรอบ
              </div>
            </div>
            <div className="flex justify-end border-t p-5">
              <Button onClick={() => setShowGuide(false)}>เริ่มใช้งาน</Button>
            </div>
          </div>
        </div>
      )}

      <header className="flex h-[78px] flex-col gap-3 border-b border-border bg-white px-5 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-primary text-primary-foreground">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-normal">สตูดิโอจำลองแผนขนส่ง VRP</h1>
              <p className="text-xs text-muted-foreground">ใช้แผนที่จริงและพิกัดจริง เพื่อจำลองคำสั่งส่ง รถ และข้อจำกัด</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={optimizerState === "ready" || optimizerState === "traffic" ? "success" : "muted"}>{statusLabel(optimizerState)}</Badge>
          <Button variant="outline" size="sm" onClick={() => setShowGuide(true)}>
            <CircleHelp className="h-4 w-4" />
            วิธีใช้
          </Button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-78px)] grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)_396px]">
        <aside className="overflow-y-auto border-b border-border bg-[#F8FAFC] p-4 lg:border-b-0 lg:border-r">
          <Tabs value={activePanel} onValueChange={(value) => setActivePanel(value as typeof activePanel)}>
            <div className="mb-4 rounded-[14px] border border-border bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">ทำงาน 3 ขั้นตอน</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">ใส่พิกัดจริง สร้างรถ/ออเดอร์จำลอง แล้วกดคำนวณ ผลลัพธ์อยู่ด้านขวาเสมอ</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowGuide(true)}>
                  วิธีใช้
                </Button>
              </div>
            </div>

            <TabsList className="grid w-full grid-cols-1 gap-2">
              {panels.map((panel) => {
                const Icon = panel.icon;
                const stepNumber = panels.findIndex((item) => item.id === panel.id) + 1;
                return (
                  <TabsTrigger key={panel.id} value={panel.id} className="h-10 justify-start gap-3 px-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">
                      {stepNumber}
                    </span>
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{panel.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value="planning" className="mt-4 space-y-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>พื้นที่วางแผน</CardTitle>
                  <CardDescription>{scenarioName}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="วันที่วางแผน">
                    <Input
                      type="date"
                      value={planningDate}
                      onChange={(event) => {
                        setPlanningDate(event.target.value);
                        setResult(emptyScenarioResult(scenarioName || "draft"));
                        setHasCalculatedRoute(false);
                      }}
                    />
                  </Field>
                  <Field label="ชื่อสถานการณ์">
                    <Input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <ScenarioStat icon={Boxes} label="CBM" value={`${totalDemand.cbm.toFixed(1)} / ${totalCapacity.cbm.toFixed(1)}`} />
                    <ScenarioStat icon={Clock3} label="เวลาบริการ" value={`${dailyOrders.reduce((sum, order) => sum + order.serviceMinutes, 0)} นาที`} />
                  </div>
                  <Button className="w-full" onClick={() => runOptimization()} disabled={isRunning}>
                    {isRunning ? <LoadingSpinner /> : <Play className="h-4 w-4" />}
                    {isRunning ? (optimizerState === "warming" ? "กำลังปลุกตัวคำนวณ" : "กำลังคำนวณ") : "คำนวณเส้นทาง"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>จุดส่งและคลัง</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {locations.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      onClick={() => setSelectedLocationId(location.id)}
                      className="flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                    >
                      <span className="truncate">{location.name}</span>
                      <Badge variant={location.type === "depot" ? "default" : "muted"}>{locationTypeLabel(location.type)}</Badge>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upload" className="mt-4 space-y-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>นำเข้าพิกัดสาขา</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="วันที่วางแผน">
                    <Input
                      type="date"
                      value={planningDate}
                      onChange={(event) => {
                        setPlanningDate(event.target.value);
                        setResult(emptyScenarioResult(scenarioName || "draft"));
                        setHasCalculatedRoute(false);
                      }}
                    />
                  </Field>
                  <Button variant="outline" className="w-full" onClick={downloadCsvTemplate}>
                    <Download className="h-4 w-4" />
                    ดาวน์โหลด template CSV
                  </Button>
                  <Input type="file" accept=".csv,text/csv" onChange={importCsvFile} />
                  <Textarea
                    value={csvText}
                    onChange={(event) => setCsvText(event.target.value)}
                    placeholder="วางข้อมูล CSV ที่ต้องการนำเข้า หรือกดใช้ template ของวันที่เลือก"
                  />
                  <Button variant="outline" className="w-full" onClick={() => setCsvText(csvTemplate)}>
                    ใช้ template ของวันที่เลือก
                  </Button>
                  <Button className="w-full" onClick={importCsv}>
                    <Upload className="h-4 w-4" />
                    นำเข้าพิกัด
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-slate-200">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>ตัวแปรสาขา</CardTitle>
                      <CardDescription>ข้อมูลด้านล่างเป็นค่าของวันที่ {planningDate}</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={addBranch}>
                      <Plus className="h-4 w-4" />
                      เพิ่มสาขา
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedLocation && (
                    <>
                      <Field label="เลือกสาขาที่ต้องการแก้ไข">
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold text-foreground"
                          value={selectedLocation.id}
                          onChange={(event) => setSelectedLocationId(event.target.value)}
                        >
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name} · {locationTypeLabel(location.type)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="rounded-md border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                        คลิก marker บนแผนที่เพื่อเปิด popup และเลือกแก้ไขสาขานั้นได้เช่นกัน
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="รหัส">
                          <Input value={selectedLocation.id} readOnly />
                        </Field>
                        <Field label="ประเภท">
                          <Input value={locationTypeLabel(selectedLocation.type)} readOnly />
                        </Field>
                        <Field label="ชื่อ">
                          <Input value={selectedLocation.name} onChange={(event) => updateSelectedLocation({ name: event.target.value })} />
                        </Field>
                        <Field label="ที่อยู่">
                          <Input value={selectedLocation.address ?? ""} onChange={(event) => updateSelectedLocation({ address: event.target.value })} />
                        </Field>
                        <Field label="Latitude">
                          <Input type="number" value={selectedLocation.lat} onChange={(event) => updateSelectedLocation({ lat: Number(event.target.value) })} />
                        </Field>
                        <Field label="Longitude">
                          <Input type="number" value={selectedLocation.lng} onChange={(event) => updateSelectedLocation({ lng: Number(event.target.value) })} />
                        </Field>
                      </div>

                      {selectedLocation.type === "store" ? (
                        <div className="grid grid-cols-2 gap-3 border-t pt-3">
                          <Field label="น้ำหนัก กก.">
                            <Input
                              type="number"
                              value={selectedBranchOrder?.weightKg ?? 120}
                              onChange={(event) => updateSelectedBranchOrder({ weightKg: Number(event.target.value) })}
                            />
                          </Field>
                          <Field label="CBM">
                            <Input
                              type="number"
                              value={selectedBranchOrder?.cbm ?? 1}
                              onChange={(event) => updateSelectedBranchOrder({ cbm: Number(event.target.value) })}
                            />
                          </Field>
                          <Field label="เวลาบริการ">
                            <Input
                              type="number"
                              value={selectedBranchOrder?.serviceMinutes ?? 15}
                              onChange={(event) => updateSelectedBranchOrder({ serviceMinutes: Number(event.target.value) })}
                            />
                          </Field>
                          <Field label="โหมดเวลา">
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                              value={selectedBranchOrder?.timeMode ?? "flexible"}
                              onChange={(event) =>
                                updateSelectedBranchOrder({
                                  timeMode: event.target.value === "fixed" ? "fixed" : "flexible",
                                  timeWindowStart: event.target.value === "fixed" ? selectedBranchOrder?.timeWindowStart || "09:00" : "",
                                  timeWindowEnd: event.target.value === "fixed" ? selectedBranchOrder?.timeWindowEnd || "10:00" : ""
                                })
                              }
                            >
                              <option value="flexible">ยืดหยุ่น</option>
                              <option value="fixed">กำหนดเวลา</option>
                            </select>
                          </Field>
                          <Field label="ความด่วน">
                            <select
                              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                              value={selectedBranchOrder?.priority ?? "normal"}
                              onChange={(event) => updateSelectedBranchOrder({ priority: event.target.value === "high" ? "high" : "normal" })}
                            >
                              <option value="normal">ปกติ</option>
                              <option value="high">ด่วน</option>
                            </select>
                          </Field>
                          <Field label="เริ่มส่ง">
                            <Input
                              type="time"
                              disabled={(selectedBranchOrder?.timeMode ?? "flexible") === "flexible"}
                              value={selectedBranchOrder?.timeWindowStart ?? ""}
                              onChange={(event) => updateSelectedBranchOrder({ timeWindowStart: event.target.value })}
                            />
                          </Field>
                          <Field label="สิ้นสุดส่ง">
                            <Input
                              type="time"
                              disabled={(selectedBranchOrder?.timeMode ?? "flexible") === "flexible"}
                              value={selectedBranchOrder?.timeWindowEnd ?? ""}
                              onChange={(event) => updateSelectedBranchOrder({ timeWindowEnd: event.target.value })}
                            />
                          </Field>
                        </div>
                      ) : (
                        <div className="rounded-md border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                          คลังใช้เป็นจุดเริ่มต้น/จุดกลับรถ จึงไม่มีน้ำหนัก, CBM หรือ time window ของออเดอร์
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vehicles" className="mt-4 space-y-4">
              <Button variant="outline" className="w-full" onClick={addVehicle}>
                <Plus className="h-4 w-4" />
                เพิ่มรถจำลอง
              </Button>
              {vehicles.map((vehicle, index) => (
                <VehicleEditor
                  key={vehicle.id}
                  vehicle={vehicle}
                  color={routeColors[index % routeColors.length]}
                  onChange={(next) => setVehicles((current) => current.map((item) => (item.id === vehicle.id ? next : item)))}
                />
              ))}
            </TabsContent>

            <TabsContent value="run" className="mt-4 space-y-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>คำนวณ VRP</CardTitle>
                  <CardDescription>{dailyOrders.length} ออเดอร์ของวันที่ {planningDate}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full" onClick={addOrder}>
                    <Plus className="h-4 w-4" />
                    เพิ่มออเดอร์จำลอง
                  </Button>
                  <div className="space-y-2">
                    {dailyOrders.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        locations={locations}
                        onChange={(next) => setOrders((current) => current.map((item) => (item.id === order.id ? next : item)))}
                      />
                    ))}
                  </div>
                  <CostModelEditor
                    costModel={costModel}
                    onChange={(patch) => {
                      setCostModel((current) => ({ ...current, ...patch }));
                      setResult(emptyScenarioResult(scenarioName || "draft"));
                      setHasCalculatedRoute(false);
                    }}
                  />
                  <Button className="w-full" onClick={() => runOptimization()} disabled={isRunning}>
                    {isRunning ? <LoadingSpinner /> : <Play className="h-4 w-4" />}
                    {isRunning ? (optimizerState === "warming" ? "กำลังปลุกตัวคำนวณ" : "กำลังจัดเส้นทาง") : "จัดเส้นทาง"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="adjust" className="mt-4 space-y-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>ปรับเส้นทางด้วยการลาก</CardTitle>
                  <CardDescription>{result.routes.length} เส้นทางที่ใช้งานอยู่</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.routes.map((route) => (
                    <RouteDropZone key={route.vehicleId} route={route} onDropStop={moveStopToRoute} />
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="warnings" className="mt-4 space-y-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>แจ้งเตือนข้อจำกัด</CardTitle>
                  <CardDescription>{allWarnings.length ? `${allWarnings.length} รายการ` : "ไม่มีข้อจำกัดที่ผิดเงื่อนไข"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {allWarnings.length ? (
                    allWarnings.map((warning) => (
                      <div key={warning} className="flex items-start gap-2 rounded-md border border-accent/50 bg-accent/10 p-3 text-sm">
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-accent" />
                        <span>{warning}</span>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border bg-secondary p-3 text-sm text-muted-foreground">สถานการณ์นี้ผ่านเงื่อนไขทั้งหมด</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="compare" className="mt-4 space-y-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle>เปรียบเทียบสถานการณ์</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {comparison.map((scenario) => (
                    <div key={scenario.scenarioId} className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium">{scenario.scenarioId}</span>
                        <Badge variant={scenario.unassignedOrders.length ? "warning" : "success"}>{statusLabel(scenario.status)}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>{scenario.totalDistanceKm.toFixed(1)} กม.</span>
                        <span>{scenario.totalDurationMinutes} นาที</span>
                        <span>{scenario.unassignedOrders.length} ค้าง</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </aside>

        <section className="relative min-h-0 overflow-hidden">
          <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-xl border border-border bg-white/95 px-3 py-2 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
            <p className="text-xs font-medium">
              แผนที่จริง · <span className="text-muted-foreground">ลากหมุดเพื่อแก้พิกัด</span>
            </p>
          </div>
          <VrpMap
            locations={locations}
            orders={dailyOrders}
            routes={result.routes}
            selectedLocationId={selectedLocationId}
            onLocationSelect={setSelectedLocationId}
            onLocationMove={updateLocation}
          />
        </section>

        <aside className="overflow-y-auto border-t border-border bg-[#F8FAFC] p-4 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between rounded-[14px] border border-border bg-white p-3">
            <div>
              <h2 className="text-base font-semibold">แผนเส้นทาง</h2>
              <p className="text-sm text-muted-foreground">
                {isRunning
                  ? "กำลังคำนวณเส้นถนนจริง..."
                  : hasCalculatedRoute
                    ? `${result.totalDistanceKm.toFixed(1)} กม., ${result.totalDurationMinutes} นาที · ${formatCurrency(result.totalCost)}`
                    : "แสดงตำแหน่งร้านก่อน ยังไม่วาดเส้นทาง"}
              </p>
            </div>
            <Badge variant={result.status === "optimized" ? "success" : "warning"}>
              {isRunning ? "กำลังคำนวณ" : hasCalculatedRoute ? statusLabel(result.status) : "ยังไม่คำนวณ"}
            </Badge>
          </div>
          {hasCalculatedRoute && result.routes.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Button className="w-full" onClick={printWorkOrders}>
                <Printer className="h-4 w-4" />
                พิมพ์ใบงาน
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setActivePanel("run")}>
                <QrCode className="h-4 w-4" />
                QR คนรถ
              </Button>
            </div>
          )}
          {hasCalculatedRoute && (
            <Card className="mb-4 border-slate-200">
              <CardHeader>
                <CardTitle>สรุปหลังคำนวณ</CardTitle>
                <CardDescription>
                  ต้นทุนจำลองรวม {formatCurrency(result.totalCost)} · objective ใช้ cost model ชุดนี้
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <RouteMetric label="ค่ารถ" value={formatCurrency(result.costBreakdown?.fixedCost)} />
                  <RouteMetric label="ค่าระยะทาง" value={formatCurrency(result.costBreakdown?.distanceCost)} />
                  <RouteMetric label="ค่าเวลา" value={formatCurrency(result.costBreakdown?.timeCost)} />
                  <RouteMetric
                    label="Penalty/OT"
                    value={formatCurrency(
                      (result.costBreakdown?.latePenalty ?? 0) +
                        (result.costBreakdown?.overtimeCost ?? 0) +
                        (result.costBreakdown?.unassignedPenalty ?? 0)
                    )}
                  />
                </div>
                {(result.summary ?? []).length > 0 && (
                  <div className="space-y-1 rounded-xl border border-slate-200 bg-[#F8FAFC] p-3 text-xs leading-relaxed text-slate-700">
                    {result.summary.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <div className="space-y-3">
            {!hasCalculatedRoute && (
              <Card className="border-slate-200">
                <CardContent className="space-y-3 pt-4">
                  <p className="text-sm font-semibold">ตอนนี้แสดงเฉพาะตำแหน่งร้านทั้งหมด</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    เมื่อพร้อมจัด route ให้ไปขั้นตอน “ออเดอร์และคำนวณ” แล้วกดคำนวณ ระบบจะวาดเส้นทางตามถนนจริงจาก routing API
                  </p>
                  <Button className="w-full" onClick={() => runOptimization()} disabled={isRunning}>
                    {isRunning ? <LoadingSpinner /> : <Play className="h-4 w-4" />}
                    {isRunning ? "กำลังคำนวณเส้นถนนจริง" : "คำนวณเส้นทางจริง"}
                  </Button>
                </CardContent>
              </Card>
            )}
            {hasCalculatedRoute && result.routes.map((route) => {
              const displayStops = compactRouteStops(route.stops);
              const deliveryStops = displayStops.filter((stop) => stop.orderIds.length > 0);
              const orderCount = route.stops.filter((stop) => stop.orderId).length;
              const driverAsset = driverAssets[route.vehicleId];
              return (
              <Card key={route.vehicleId} className="overflow-hidden border-slate-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: route.color }} />
                      {route.vehicleName}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {deliveryStops.length} จุดส่ง · {orderCount} ออเดอร์
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <RouteMetric label="ระยะทาง" value={`${route.distanceKm.toFixed(1)} กม.`} />
                    <RouteMetric label="เวลา" value={`${route.durationMinutes} นาที`} />
                    <RouteMetric label="น้ำหนัก" value={`${Math.round(route.loadKg)} กก.`} />
                    <RouteMetric label="ต้นทุน" value={formatCurrency(route.totalCost)} />
                  </div>
                  {(route.routeNotes ?? []).length > 0 && (
                    <div className="space-y-1 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950">
                      {(route.routeNotes ?? []).map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  )}
                  <div className="space-y-1">
                    {displayStops.map((stop, index) => (
                      <div key={`${route.vehicleId}-${stop.locationId}-${index}`} className="flex items-center gap-2 text-xs">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px]">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {stop.name}
                          {stop.deliveryCount > 1 && (
                            <Badge variant="muted" className="ml-2 align-middle">
                              {stop.deliveryCount} ออเดอร์
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground">{minutesToTime(stop.arrivalMinutes)}</span>
                      </div>
                    ))}
                  </div>
                  {driverAsset && (
                    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200 bg-white p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={driverAsset.qr} alt={`QR ${route.vehicleName}`} className="h-[88px] w-[88px] rounded-md border border-slate-100" />
                      <div className="min-w-0 space-y-2">
                        <p className="text-xs font-semibold">Driver mobile view</p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">สแกน QR เพื่อเปิดรายการส่งของรถคันนี้บนมือถือ</p>
                        <a
                          href={driverAsset.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-secondary"
                        >
                          <Smartphone className="h-4 w-4" />
                          เปิดหน้าคนรถ
                        </a>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
    <WorkOrdersPrint payloads={driverPayloads} assets={driverAssets} />
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function LoadingSpinner() {
  return <span className="vrp-spinner" aria-hidden="true" />;
}

function ScenarioStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F8FAFC] p-3">
      <Icon className="mb-2 h-4 w-4 text-primary" />
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-bold text-primary">{value}</div>
    </div>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F8FAFC] px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-bold text-primary">{value}</div>
    </div>
  );
}

function CostModelEditor({
  costModel,
  onChange
}: {
  costModel: CostModel;
  onChange: (patch: Partial<CostModel>) => void;
}) {
  const fields: { key: keyof CostModel; label: string; suffix: string; step?: string }[] = [
    { key: "vehicleFixedCost", label: "ค่ารถต่อคัน", suffix: "บาท" },
    { key: "costPerKm", label: "ค่าระยะทาง", suffix: "บาท/กม.", step: "0.5" },
    { key: "costPerHour", label: "ค่าเวลาเดินทาง", suffix: "บาท/ชม." },
    { key: "overtimeCostPerHour", label: "ค่า OT", suffix: "บาท/ชม." },
    { key: "driverShiftMinutes", label: "กะคนขับ", suffix: "นาที" },
    { key: "latePenaltyPerStop", label: "Penalty ช้า", suffix: "บาท/จุด" },
    { key: "unassignedPenaltyPerOrder", label: "Penalty ค้าง", suffix: "บาท/ออเดอร์" }
  ];

  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-start gap-2">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Calculator className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">Cost model จำลอง</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            เป็นค่าสมมุติสำหรับทดสอบ แก้ได้ก่อนรันเพื่อดูผลต่อต้นทุนและการเลือกเส้นทาง
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            <div className="flex items-center rounded-xl border border-input bg-white focus-within:ring-2 focus-within:ring-ring">
              <Input
                type="number"
                min="0"
                step={field.step ?? "1"}
                value={costModel[field.key]}
                onChange={(event) => onChange({ [field.key]: parseNumber(event.target.value, defaultCostModel[field.key]) } as Partial<CostModel>)}
                className="border-0 focus-visible:ring-0"
              />
              <span className="shrink-0 pr-3 text-[10px] text-muted-foreground">{field.suffix}</span>
            </div>
          </Field>
        ))}
      </div>
    </div>
  );
}

function WorkOrdersPrint({
  payloads,
  assets
}: {
  payloads: DriverRoutePayload[];
  assets: Record<string, { url: string; qr: string }>;
}) {
  if (!payloads.length) return null;

  return (
    <section className="print-workorders">
      {payloads.map((payload) => {
        const asset = assets[payload.vehicleId];
        const deliveryStops = payload.stops.filter((stop) => stop.orderId);
        return (
          <article key={payload.vehicleId} className="print-page">
            <header className="print-header">
              <div>
                <p className="print-kicker">VRP Simulation Studio</p>
                <h1>ใบงานจัดส่ง</h1>
                <p>
                  วันที่ {payload.planningDate} · แผน {payload.scenarioId}
                </p>
              </div>
              <div className="print-qr-box">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {asset?.qr && <img src={asset.qr} alt={`QR ${payload.vehicleName}`} />}
                <span>สแกนเพื่อเปิดงานบนมือถือ</span>
              </div>
            </header>

            <section className="print-summary">
              <div>
                <span>รถ</span>
                <strong>{payload.vehicleName}</strong>
              </div>
              <div>
                <span>จุดส่ง</span>
                <strong>{deliveryStops.length}</strong>
              </div>
              <div>
                <span>ระยะทาง</span>
                <strong>{payload.distanceKm.toFixed(1)} กม.</strong>
              </div>
              <div>
                <span>เวลา</span>
                <strong>{payload.durationMinutes} นาที</strong>
              </div>
              <div>
                <span>น้ำหนัก</span>
                <strong>{Math.round(payload.loadKg)} กก.</strong>
              </div>
              <div>
                <span>CBM</span>
                <strong>{payload.loadCbm.toFixed(1)}</strong>
              </div>
            </section>

            <table className="print-table">
              <thead>
                <tr>
                  <th>ลำดับ</th>
                  <th>เวลา</th>
                  <th>สาขา/คลัง</th>
                  <th>ช่วงส่ง</th>
                  <th>ปริมาณสะสม</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {payload.stops.map((stop, index) => (
                  <tr key={`${stop.locationId}-${index}`}>
                    <td>{stop.orderId ? stop.sequence : "D"}</td>
                    <td>{minutesToClock(stop.arrivalMinutes)}</td>
                    <td>
                      <strong>{stop.name}</strong>
                      <span>{stop.address || `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`}</span>
                      {stop.orderId && <span>Order: {stop.orderId}</span>}
                    </td>
                    <td>{stop.timeWindow || "-"}</td>
                    <td>
                      {stop.orderId ? (
                        <>
                          {Math.round(stop.loadKg)} กก.
                          <br />
                          {stop.loadCbm.toFixed(1)} CBM
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <span className="print-checkbox" /> ส่งแล้ว
                      <br />
                      <span className="print-checkbox" /> มีปัญหา
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <footer className="print-footer">
              <div>ผู้จัดเส้นทาง ____________________</div>
              <div>คนขับ ____________________</div>
            </footer>
          </article>
        );
      })}
    </section>
  );
}

function VehicleEditor({
  vehicle,
  color,
  onChange
}: {
  vehicle: Vehicle;
  color: string;
  onChange: (vehicle: Vehicle) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
          {vehicle.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Field label="ชื่อรถ">
          <Input value={vehicle.name} onChange={(event) => onChange({ ...vehicle, name: event.target.value })} />
        </Field>
        <Field label="จุดส่งสูงสุด">
          <Input
            type="number"
            value={vehicle.maxStops}
            onChange={(event) => onChange({ ...vehicle, maxStops: Number(event.target.value) })}
          />
        </Field>
        <Field label="รับน้ำหนัก กก.">
          <Input
            type="number"
            value={vehicle.capacityKg}
            onChange={(event) => onChange({ ...vehicle, capacityKg: Number(event.target.value) })}
          />
        </Field>
        <Field label="รับปริมาตร CBM">
          <Input
            type="number"
            value={vehicle.capacityCbm}
            onChange={(event) => onChange({ ...vehicle, capacityCbm: Number(event.target.value) })}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

function OrderRow({
  order,
  locations,
  onChange
}: {
  order: Order;
  locations: LocationPoint[];
  onChange: (order: Order) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{order.id}</span>
        <Badge variant={order.priority === "high" ? "warning" : "muted"}>{priorityLabel(order.priority)}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="สาขา">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={order.locationId}
            onChange={(event) => onChange({ ...order, locationId: event.target.value })}
          >
            {locations
              .filter((location) => location.type === "store")
              .map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="น้ำหนัก กก.">
          <Input type="number" value={order.weightKg} onChange={(event) => onChange({ ...order, weightKg: Number(event.target.value) })} />
        </Field>
        <Field label="CBM">
          <Input type="number" value={order.cbm} onChange={(event) => onChange({ ...order, cbm: Number(event.target.value) })} />
        </Field>
        <Field label="เวลาบริการ">
          <Input
            type="number"
            value={order.serviceMinutes}
            onChange={(event) => onChange({ ...order, serviceMinutes: Number(event.target.value) })}
          />
        </Field>
      </div>
    </div>
  );
}

function RouteDropZone({
  route,
  onDropStop
}: {
  route: RoutePlan;
  onDropStop: (event: DragEvent<HTMLDivElement>, toVehicleId: string) => void;
}) {
  return (
    <div
      className="rounded-md border p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropStop(event, route.vehicleId)}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{route.vehicleName}</span>
        <span className="text-xs text-muted-foreground">{route.loadKg} กก.</span>
      </div>
      <div className="space-y-1">
        {route.stops
          .filter((stop) => stop.orderId)
          .map((stop) => (
            <div
              key={stop.orderId}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/order-id", stop.orderId ?? "")}
              className="cursor-grab rounded-md bg-secondary px-3 py-2 text-sm active:cursor-grabbing"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{stop.name}</span>
                <span className="text-xs text-muted-foreground">{stop.orderId}</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
