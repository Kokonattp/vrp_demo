"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Boxes,
  Clock3,
  FileUp,
  MapPinned,
  Play,
  Plus,
  Route,
  Truck,
  Upload
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

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const panels = [
  { id: "planning", label: "Planning", icon: MapPinned },
  { id: "upload", label: "Upload", icon: FileUp },
  { id: "vehicles", label: "Vehicles", icon: Truck },
  { id: "run", label: "Run VRP", icon: Play },
  { id: "adjust", label: "Adjust", icon: ArrowRightLeft },
  { id: "warnings", label: "Warnings", icon: AlertTriangle },
  { id: "compare", label: "Compare", icon: BarChart3 }
] as const;

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
          stopWarnings.push("Time window");
          warnings.push(`${order.id} misses ${order.timeWindowEnd}`);
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
    warnings: ["Local fallback used. Start the FastAPI backend for OR-Tools optimization."],
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
        name: name || `Store ${index + 1}`,
        type,
        lat: Number(lat),
        lng: Number(lng),
        address
      };
    })
    .filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
}

export default function Home() {
  const [activePanel, setActivePanel] = useState<(typeof panels)[number]["id"]>("planning");
  const [locations, setLocations] = useState<LocationPoint[]>(sampleLocations);
  const [vehicles, setVehicles] = useState<Vehicle[]>(sampleVehicles);
  const [orders, setOrders] = useState<Order[]>(sampleOrders);
  const [result, setResult] = useState<ScenarioResult>(() =>
    buildLocalFallback("baseline", "depot-bkk", sampleLocations, sampleVehicles, sampleOrders)
  );
  const [comparison, setComparison] = useState<ScenarioResult[]>(initialScenarioComparison);
  const [csvText, setCsvText] = useState("depot-bkk,Bangkok Distribution Hub,13.7563,100.5018,Bangkok\nstore-new,New Store,13.7440,100.5620,Sukhumvit");
  const [selectedLocationId, setSelectedLocationId] = useState("depot-bkk");
  const [isRunning, setIsRunning] = useState(false);
  const [optimizerState, setOptimizerState] = useState<"warming" | "ready" | "offline">("warming");
  const [scenarioName, setScenarioName] = useState("morning-wave");

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
    () => [...result.warnings, ...result.routes.flatMap((route) => route.warnings), ...result.unassignedOrders.map((id) => `${id} unassigned`)],
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
      setActivePanel("adjust");
    }
  };

  const addVehicle = () => {
    if (!depot) return;
    setVehicles((current) => [
      ...current,
      {
        id: `veh-${current.length + 1}`,
        name: `Virtual Van ${current.length + 1}`,
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
        ...(vehicle && loadKg > vehicle.capacityKg ? [`${vehicle.name} capacity kg exceeded`] : []),
        ...(vehicle && loadCbm > vehicle.capacityCbm ? [`${vehicle.name} capacity CBM exceeded`] : []),
        ...(vehicle && orderStops.length > vehicle.maxStops ? [`${vehicle.name} max stops exceeded`] : [])
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
      warnings: ["Manual route adjustment applied. Re-run VRP to re-optimize sequence."]
    }));
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="flex flex-col gap-4 border-b bg-card px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">VRP Simulation Studio</h1>
              <p className="text-sm text-muted-foreground">Real maps, real coordinates, simulated logistics scenarios.</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Optimizer" value={optimizerState} />
          <Metric label="Stores" value={locations.filter((location) => location.type === "store").length.toString()} />
          <Metric label="Vehicles" value={vehicles.length.toString()} />
          <Metric label="Demand" value={`${Math.round(totalDemand.kg)} kg`} />
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-89px)] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)_380px]">
        <aside className="border-b bg-card p-4 lg:border-b-0 lg:border-r">
          <Tabs value={activePanel} onValueChange={(value) => setActivePanel(value as typeof activePanel)}>
            <TabsList className="grid w-full grid-cols-4 gap-1 lg:grid-cols-2">
              {panels.map((panel) => {
                const Icon = panel.icon;
                return (
                  <TabsTrigger key={panel.id} value={panel.id} className="justify-start gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <span>{panel.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value="planning" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Planning Workspace</CardTitle>
                  <CardDescription>{scenarioName}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Scenario">
                    <Input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <ScenarioStat icon={Boxes} label="CBM" value={`${totalDemand.cbm.toFixed(1)} / ${totalCapacity.cbm.toFixed(1)}`} />
                    <ScenarioStat icon={Clock3} label="Service" value={`${orders.reduce((sum, order) => sum + order.serviceMinutes, 0)} min`} />
                  </div>
                  <Button className="w-full" onClick={runOptimization} disabled={isRunning}>
                    <Play className="h-4 w-4" />
                    {isRunning ? (optimizerState === "warming" ? "Warming optimizer" : "Running") : "Run VRP"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Locations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {locations.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      onClick={() => setSelectedLocationId(location.id)}
                      className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-secondary"
                    >
                      <span className="truncate">{location.name}</span>
                      <Badge variant={location.type === "depot" ? "default" : "muted"}>{location.type}</Badge>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upload" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Locations</CardTitle>
                  <CardDescription>id, name, lat, lng, address</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input type="file" accept=".csv,text/csv" onChange={importCsvFile} />
                  <Textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} />
                  <Button className="w-full" onClick={importCsv}>
                    <Upload className="h-4 w-4" />
                    Import Coordinates
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vehicles" className="mt-4 space-y-4">
              <Button variant="outline" className="w-full" onClick={addVehicle}>
                <Plus className="h-4 w-4" />
                Add Virtual Vehicle
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
              <Card>
                <CardHeader>
                  <CardTitle>Run VRP</CardTitle>
                  <CardDescription>{orders.length} simulated delivery orders</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full" onClick={addOrder}>
                    <Plus className="h-4 w-4" />
                    Add Simulated Order
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
                    {isRunning ? (optimizerState === "warming" ? "Warming optimizer" : "Optimizing") : "Optimize Routes"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="adjust" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Drag Route Adjustment</CardTitle>
                  <CardDescription>{result.routes.length} active routes</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.routes.map((route) => (
                    <RouteDropZone key={route.vehicleId} route={route} onDropStop={moveStopToRoute} />
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="warnings" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Constraint Warnings</CardTitle>
                  <CardDescription>{allWarnings.length || "No active warnings"}</CardDescription>
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
                    <div className="rounded-md border bg-secondary p-3 text-sm text-muted-foreground">All constraints pass for this scenario.</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="compare" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Scenario Comparison</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {comparison.map((scenario) => (
                    <div key={scenario.scenarioId} className="rounded-md border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium">{scenario.scenarioId}</span>
                        <Badge variant={scenario.unassignedOrders.length ? "warning" : "success"}>{scenario.status}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span>{scenario.totalDistanceKm.toFixed(1)} km</span>
                        <span>{scenario.totalDurationMinutes} min</span>
                        <span>{scenario.unassignedOrders.length} open</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </aside>

        <section className="min-h-[520px]">
          <VrpMap locations={locations} routes={result.routes} selectedLocationId={selectedLocationId} onLocationMove={updateLocation} />
        </section>

        <aside className="border-t bg-card p-4 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Route Plan</h2>
              <p className="text-sm text-muted-foreground">
                {result.totalDistanceKm.toFixed(1)} km, {result.totalDurationMinutes} min
              </p>
            </div>
            <Badge variant={result.status === "optimized" ? "success" : "warning"}>{result.status}</Badge>
          </div>
          <div className="space-y-3">
            {result.routes.map((route) => (
              <Card key={route.vehicleId}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: route.color }} />
                      {route.vehicleName}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">{route.stops.length - 2} stops</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <RouteMetric label="Distance" value={`${route.distanceKm.toFixed(1)} km`} />
                    <RouteMetric label="Duration" value={`${route.durationMinutes} m`} />
                    <RouteMetric label="Load" value={`${Math.round(route.loadKg)} kg`} />
                  </div>
                  <div className="space-y-1">
                    {route.stops.map((stop, index) => (
                      <div key={`${route.vehicleId}-${stop.locationId}-${index}`} className="flex items-center gap-2 text-xs">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px]">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{stop.name}</span>
                        <span className="text-muted-foreground">{minutesToTime(stop.arrivalMinutes)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function ScenarioStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <Icon className="mb-2 h-4 w-4 text-primary" />
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary p-2">
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
        <Field label="Name">
          <Input value={vehicle.name} onChange={(event) => onChange({ ...vehicle, name: event.target.value })} />
        </Field>
        <Field label="Max stops">
          <Input
            type="number"
            value={vehicle.maxStops}
            onChange={(event) => onChange({ ...vehicle, maxStops: Number(event.target.value) })}
          />
        </Field>
        <Field label="Capacity kg">
          <Input
            type="number"
            value={vehicle.capacityKg}
            onChange={(event) => onChange({ ...vehicle, capacityKg: Number(event.target.value) })}
          />
        </Field>
        <Field label="Capacity CBM">
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
        <Badge variant={order.priority === "high" ? "warning" : "muted"}>{order.priority}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Store">
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
        <Field label="Weight kg">
          <Input type="number" value={order.weightKg} onChange={(event) => onChange({ ...order, weightKg: Number(event.target.value) })} />
        </Field>
        <Field label="CBM">
          <Input type="number" value={order.cbm} onChange={(event) => onChange({ ...order, cbm: Number(event.target.value) })} />
        </Field>
        <Field label="Service">
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
        <span className="text-xs text-muted-foreground">{route.loadKg} kg</span>
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
