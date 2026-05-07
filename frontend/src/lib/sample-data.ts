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
    lng: 100.5347
  },
  {
    id: "store-ari",
    name: "สาขาอารีย์",
    type: "store",
    lat: 13.7801,
    lng: 100.5446
  },
  {
    id: "store-thonglor",
    name: "สาขาทองหล่อ",
    type: "store",
    lat: 13.7307,
    lng: 100.5826
  },
  {
    id: "store-rama9",
    name: "สาขาพระราม 9",
    type: "store",
    lat: 13.7579,
    lng: 100.565
  },
  {
    id: "store-bangna",
    name: "สาขาบางนา",
    type: "store",
    lat: 13.6682,
    lng: 100.6047
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
    serviceDate: sampleServiceDate,
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
    serviceDate: sampleServiceDate,
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
    serviceDate: sampleServiceDate,
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
    serviceDate: sampleServiceDate,
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
    warnings: ["สถานการณ์พื้นฐานใช้ระยะทางประมาณการระหว่างรอข้อมูล routing API"],
    routes: []
  },
  {
    scenarioId: "small-fleet",
    status: "fallback",
    objective: 0,
    totalDistanceKm: 64.7,
    totalDurationMinutes: 248,
    unassignedOrders: ["ord-1005"],
    warnings: ["มีหนึ่งออเดอร์ที่เกินความจุคงเหลือของแผนรถลดจำนวน"],
    routes: []
  }
];
