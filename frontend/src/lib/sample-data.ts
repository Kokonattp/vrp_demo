import type { LocationPoint, Order, ScenarioResult, Vehicle } from "@/types/vrp";

const sampleServiceDate = (() => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
})();

export const routeColors = ["#1B2E4B", "#3B82F6", "#10B981", "#7C3AED", "#EF4444"];

export const sampleLocations: LocationPoint[] = [
  {
    id: "depot-bkk",
    name: "ศูนย์กระจายสินค้ากรุงเทพ",
    type: "depot",
    lat: 13.7563,
    lng: 100.5018,
    address: "กรุงเทพมหานคร"
  },
  {
    id: "store-silom",
    name: "สาขาสีลม",
    type: "store",
    lat: 13.7246,
    lng: 100.5347,
    address: "สีลม, บางรัก, กรุงเทพมหานคร",
    clusterId: "cluster-1"
  },
  {
    id: "store-ari",
    name: "สาขาอารีย์",
    type: "store",
    lat: 13.7801,
    lng: 100.5446,
    address: "อารีย์, พญาไท, กรุงเทพมหานคร",
    clusterId: "cluster-2"
  },
  {
    id: "store-thonglor",
    name: "สาขาทองหล่อ",
    type: "store",
    lat: 13.7307,
    lng: 100.5826,
    address: "ทองหล่อ, วัฒนา, กรุงเทพมหานคร",
    clusterId: "cluster-3"
  },
  {
    id: "store-rama9",
    name: "สาขาพระราม 9",
    type: "store",
    lat: 13.7579,
    lng: 100.565,
    address: "พระราม 9, ห้วยขวาง, กรุงเทพมหานคร",
    clusterId: "cluster-2"
  },
  {
    id: "store-bangna",
    name: "สาขาบางนา",
    type: "store",
    lat: 13.6682,
    lng: 100.6047,
    address: "บางนา, กรุงเทพมหานคร",
    clusterId: "cluster-3"
  }
];

export const sampleVehicles: Vehicle[] = [
  {
    id: "veh-1",
    name: "รถตู้ไฟฟ้า 01",
    capacityKg: 900,
    capacityCbm: 8,
    maxStops: 5,
    startLocationId: "depot-bkk",
    endLocationId: "depot-bkk",
    restrictedZones: ["low-emission-only"]
  },
  {
    id: "veh-2",
    name: "รถบรรทุกตู้ทึบ 02",
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
    serviceDate: sampleServiceDate,
    timeMode: "flexible",
    weightKg: 180,
    cbm: 1.2,
    serviceMinutes: 18,
    timeWindowStart: "",
    timeWindowEnd: "",
    priority: "high"
  },
  {
    id: "ord-1002",
    locationId: "store-ari",
    serviceDate: sampleServiceDate,
    timeMode: "flexible",
    weightKg: 240,
    cbm: 1.6,
    serviceMinutes: 20,
    timeWindowStart: "",
    timeWindowEnd: "",
    priority: "normal"
  },
  {
    id: "ord-1003",
    locationId: "store-thonglor",
    serviceDate: sampleServiceDate,
    timeMode: "flexible",
    weightKg: 320,
    cbm: 2.4,
    serviceMinutes: 25,
    timeWindowStart: "",
    timeWindowEnd: "",
    priority: "normal"
  },
  {
    id: "ord-1004",
    locationId: "store-rama9",
    serviceDate: sampleServiceDate,
    timeMode: "fixed",
    weightKg: 210,
    cbm: 1.3,
    serviceMinutes: 16,
    timeWindowStart: "09:00",
    timeWindowEnd: "09:30",
    priority: "high"
  },
  {
    id: "ord-1005",
    locationId: "store-bangna",
    serviceDate: sampleServiceDate,
    timeMode: "fixed",
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
    totalCost: 0,
    costBreakdown: {},
    summary: [],
    unassignedOrders: [],
    warnings: ["สถานการณ์พื้นฐานใช้ระยะทางประมาณการระหว่างรอข้อมูล routing API"],
    routes: []
  },
  {
    scenarioId: "small-fleet",
    status: "fallback",
    objective: 0,
    totalDistanceKm: 64.7,
    totalDurationMinutes: 248,
    totalCost: 0,
    costBreakdown: {},
    summary: [],
    unassignedOrders: ["ord-1005"],
    warnings: ["มีหนึ่งออเดอร์ที่เกินความจุคงเหลือของแผนรถลดจำนวน"],
    routes: []
  }
];
