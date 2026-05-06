"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  Boxes,
  CircleHelp,
  Clock3,
  FileUp,
  Play,
  Plus,
  Route,
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
import { initialScenarioComparison, routeColors, sampleLocations, sampleOrders, sampleVehicles } from "@/lib/sample-data";
import type { Coordinate, LocationPoint, OptimizeRequest, Order, RoutePlan, RouteStop, ScenarioResult, Vehicle } from "@/types/vrp";

const VrpMap = dynamic(() => import("@/components/vrp-map").then((mod) => mod.VrpMap), { ssr: false });

const API_URL = "";

const panels = [
  { id: "upload", label: "พิกัดสาขา", icon: FileUp },
  { id: "vehicles", label: "รถจำลอง", icon: Truck },
  { id: "run", label: "ออเดอร์และคำนวณ", icon: Play }
] as const;

function statusLabel(value: ScenarioResult["status"] | "warming" | "ready" | "offline") {
  const labels = {
    optimized: "คำนวณแล้ว",
    fallback: "ประมาณการ",
    infeasible: "จัดไม่ได้",
    warming: "กำลังปลุก",
    ready: "พร้อมใช้",
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

function buildLocalFallback(
  scenarioId: string,
  depotId: string,
  locations: LocationPoint[],
  vehicles: Vehicle[],
  orders: Order[]
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

  orders.forEach((order) => {
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
        if (elapsed < timeToMinutes(order.timeWindowStart)) {
          elapsed = timeToMinutes(order.timeWindowStart);
        }
        if (elapsed > timeToMinutes(order.timeWindowEnd)) {
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

      return {
        vehicleId: bucket.vehicle.id,
        vehicleName: bucket.vehicle.name,
        color: routeColors[index % routeColors.length],
        stops,
        distanceKm: Number(routeDistance.toFixed(1)),
        durationMinutes: Math.round(elapsed - 8 * 60),
        loadKg: bucket.loadKg,
        loadCbm: Number(bucket.loadCbm.toFixed(1)),
        warnings,
        geometry: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }))
      };
    });

  return {
    scenarioId,
    status: "fallback",
    objective: routes.reduce((sum, route) => sum + route.distanceKm, 0),
    totalDistanceKm: Number(routes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1)),
    totalDurationMinutes: routes.reduce((sum, route) => sum + route.durationMinutes, 0),
    unassignedOrders,
    warnings: ["ใช้แผนประมาณการในเครื่อง เพราะยังติดต่อ backend OR-Tools ไม่สำเร็จ"],
    routes
  };
}

function parseLocationsCsv(csv: string): LocationPoint[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [id, name, lat, lng, address] = line.split(",").map((cell) => cell.trim());
      const type: LocationPoint["type"] = index === 0 && (id || "").toLowerCase().includes("depot") ? "depot" : "store";
      return {
        id: id || `store-${index + 1}`,
        name: name || `สาขา ${index + 1}`,
        type,
        lat: Number(lat),
        lng: Number(lng),
        address
      };
    })
    .filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
}

export default function Home() {
  const [activePanel, setActivePanel] = useState<(typeof panels)[number]["id"]>("upload");
  const [locations, setLocations] = useState<LocationPoint[]>(sampleLocations);
  const [vehicles, setVehicles] = useState<Vehicle[]>(sampleVehicles);
  const [orders, setOrders] = useState<Order[]>(sampleOrders);
  const [result, setResult] = useState<ScenarioResult>(() =>
    buildLocalFallback("baseline", "depot-bkk", sampleLocations, sampleVehicles, sampleOrders)
  );
  const [comparison, setComparison] = useState<ScenarioResult[]>(initialScenarioComparison);
  const [csvText, setCsvText] = useState("depot-bkk,ศูนย์กระจายสินค้ากรุงเทพ,13.7563,100.5018,กรุงเทพมหานคร\nstore-new,สาขาใหม่,13.7440,100.5620,สุขุมวิท");
  const [selectedLocationId, setSelectedLocationId] = useState("depot-bkk");
  const [isRunning, setIsRunning] = useState(false);
  const [optimizerState, setOptimizerState] = useState<"warming" | "ready" | "offline">("warming");
  const [scenarioName, setScenarioName] = useState("morning-wave");
  const [showGuide, setShowGuide] = useState(false);

  const depot = useMemo(() => locations.find((location) => location.type === "depot") ?? locations[0], [locations]);
  const totalDemand = useMemo(
    () =>
      orders.reduce(
        (sum, order) => ({
          kg: sum.kg + order.weightKg,
          cbm: sum.cbm + order.cbm
        }),
        { kg: 0, cbm: 0 }
      ),
    [orders]
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

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12000);

    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((response) => setOptimizerState(response.ok ? "ready" : "offline"))
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
  }, []);

  const runOptimization = async () => {
    if (!depot) return;
    setIsRunning(true);
    setOptimizerState((current) => (current === "ready" ? current : "warming"));
    const payload: OptimizeRequest = {
      scenarioId: scenarioName || `scenario-${Date.now()}`,
      depotId: depot.id,
      locations,
      vehicles,
      orders
    };

    try {
      const response = await fetch(`${API_URL}/api/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`Optimizer returned ${response.status}`);
      const optimized = (await response.json()) as ScenarioResult;
      setOptimizerState("ready");
      setResult(optimized);
      setComparison((current) => [optimized, ...current.filter((item) => item.scenarioId !== optimized.scenarioId)].slice(0, 4));
    } catch {
      setOptimizerState("offline");
      const fallback = buildLocalFallback(payload.scenarioId, payload.depotId, payload.locations, payload.vehicles, payload.orders);
      setResult(fallback);
      setComparison((current) => [fallback, ...current.filter((item) => item.scenarioId !== fallback.scenarioId)].slice(0, 4));
    } finally {
      setIsRunning(false);
      setActivePanel("run");
    }
  };

  const addVehicle = () => {
    if (!depot) return;
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
    setOrders((current) => [
      ...current,
      {
        id: `ord-${1000 + current.length + 1}`,
        locationId: store.id,
        weightKg: 120,
        cbm: 1,
        serviceMinutes: 15,
        timeWindowStart: "09:00",
        timeWindowEnd: "17:00",
        priority: "normal"
      }
    ]);
  };

  const importCsv = () => {
    const parsed = parseLocationsCsv(csvText);
    if (!parsed.length) return;
    const hasDepot = parsed.some((location) => location.type === "depot");
    setLocations(hasDepot ? parsed : [{ ...parsed[0], type: "depot" }, ...parsed.slice(1)]);
    setSelectedLocationId(parsed[0].id);
  };

  const importCsvFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setCsvText(text));
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
      return {
        ...route,
        stops,
        geometry: stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        loadKg,
        loadCbm,
        distanceKm: Number(routeDistance.toFixed(1)),
        durationMinutes: Math.round((routeDistance / 28) * 60 + orderStops.reduce((sum, stop) => sum + stop.serviceMinutes, 0)),
        warnings
      };
    });
    setResult((current) => ({
      ...current,
      status: "fallback",
      routes: nextRoutes,
      totalDistanceKm: Number(nextRoutes.reduce((sum, route) => sum + route.distanceKm, 0).toFixed(1)),
      totalDurationMinutes: nextRoutes.reduce((sum, route) => sum + route.durationMinutes, 0),
      warnings: ["มีการปรับเส้นทางด้วยมือ ควรคำนวณ VRP ใหม่เพื่อจัดลำดับจุดส่งอีกครั้ง"]
    }));
  };

  return (
    <main className="h-screen overflow-hidden bg-[linear-gradient(180deg,#f7fafc_0%,#eef4f7_100%)]">
      {showGuide && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-lg border bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
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
                <div key={number} className="flex gap-3 rounded-lg border bg-slate-50 p-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
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

      <header className="flex h-[78px] flex-col gap-3 border-b bg-white/95 px-5 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_12px_26px_rgba(15,118,128,0.22)]">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-normal">สตูดิโอจำลองแผนขนส่ง VRP</h1>
              <p className="text-xs text-muted-foreground">ใช้แผนที่จริงและพิกัดจริง เพื่อจำลองคำสั่งส่ง รถ และข้อจำกัด</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={optimizerState === "ready" ? "success" : "muted"}>{statusLabel(optimizerState)}</Badge>
          <Button variant="outline" size="sm" onClick={() => setShowGuide(true)}>
            <CircleHelp className="h-4 w-4" />
            วิธีใช้
          </Button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-78px)] grid-cols-1 overflow-hidden lg:grid-cols-[360px_minmax(0,1fr)_396px]">
        <aside className="overflow-y-auto border-b bg-white/85 p-4 backdrop-blur lg:border-b-0 lg:border-r">
          <Tabs value={activePanel} onValueChange={(value) => setActivePanel(value as typeof activePanel)}>
            <div className="mb-4 rounded-lg border bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
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

            <TabsList className="grid w-full grid-cols-1 gap-1.5 border bg-white p-1.5 shadow-sm">
              {panels.map((panel) => {
                const Icon = panel.icon;
                const stepNumber = panels.findIndex((item) => item.id === panel.id) + 1;
                return (
                  <TabsTrigger key={panel.id} value={panel.id} className="h-10 justify-start gap-3 px-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-secondary text-[11px] font-semibold text-muted-foreground">
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
                  <Field label="ชื่อสถานการณ์">
                    <Input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <ScenarioStat icon={Boxes} label="CBM" value={`${totalDemand.cbm.toFixed(1)} / ${totalCapacity.cbm.toFixed(1)}`} />
                    <ScenarioStat icon={Clock3} label="เวลาบริการ" value={`${orders.reduce((sum, order) => sum + order.serviceMinutes, 0)} นาที`} />
                  </div>
                  <Button className="w-full" onClick={runOptimization} disabled={isRunning}>
                    <Play className="h-4 w-4" />
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
                  <CardDescription>id, ชื่อ, lat, lng, ที่อยู่</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input type="file" accept=".csv,text/csv" onChange={importCsvFile} />
                  <Textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} />
                  <Button className="w-full" onClick={importCsv}>
                    <Upload className="h-4 w-4" />
                    นำเข้าพิกัด
                  </Button>
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
                  <CardDescription>{orders.length} ออเดอร์จำลอง</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full" onClick={addOrder}>
                    <Plus className="h-4 w-4" />
                    เพิ่มออเดอร์จำลอง
                  </Button>
                  <div className="space-y-2">
                    {orders.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        locations={locations}
                        onChange={(next) => setOrders((current) => current.map((item) => (item.id === order.id ? next : item)))}
                      />
                    ))}
                  </div>
                  <Button className="w-full" onClick={runOptimization} disabled={isRunning}>
                    <Play className="h-4 w-4" />
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
          <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border bg-white/92 px-3 py-2 shadow-[0_18px_42px_rgba(15,23,42,0.14)] backdrop-blur">
            <p className="text-xs font-medium">
              แผนที่จริง · <span className="text-muted-foreground">ลากหมุดเพื่อแก้พิกัด</span>
            </p>
          </div>
          <VrpMap locations={locations} routes={result.routes} selectedLocationId={selectedLocationId} onLocationMove={updateLocation} />
        </section>

        <aside className="overflow-y-auto border-t bg-white/85 p-4 backdrop-blur lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between rounded-lg border bg-white p-3 shadow-sm">
            <div>
              <h2 className="text-base font-semibold">แผนเส้นทาง</h2>
              <p className="text-sm text-muted-foreground">
                {result.totalDistanceKm.toFixed(1)} กม., {result.totalDurationMinutes} นาที
              </p>
            </div>
            <Badge variant={result.status === "optimized" ? "success" : "warning"}>{statusLabel(result.status)}</Badge>
          </div>
          <div className="space-y-3">
            {result.routes.map((route) => {
              const displayStops = compactRouteStops(route.stops);
              const deliveryStops = displayStops.filter((stop) => stop.orderIds.length > 0);
              const orderCount = route.stops.filter((stop) => stop.orderId).length;
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
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <RouteMetric label="ระยะทาง" value={`${route.distanceKm.toFixed(1)} กม.`} />
                    <RouteMetric label="เวลา" value={`${route.durationMinutes} นาที`} />
                    <RouteMetric label="น้ำหนัก" value={`${Math.round(route.loadKg)} กก.`} />
                  </div>
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
                </CardContent>
              </Card>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
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

function ScenarioStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <Icon className="mb-2 h-4 w-4 text-primary" />
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-slate-50 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
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
