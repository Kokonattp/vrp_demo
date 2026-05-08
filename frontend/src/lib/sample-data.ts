import type { LocationPoint, Order, ScenarioResult, Vehicle } from "@/types/vrp";

const sampleServiceDate = (() => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
})();

export const routeColors = [
  "#1B2E4B",
  "#2563EB",
  "#059669",
  "#7C3AED",
  "#DC2626",
  "#D97706",
  "#0891B2",
  "#BE123C",
  "#4338CA",
  "#15803D",
  "#A16207",
  "#0F766E"
];

const sampleStoreSeeds: Array<Omit<LocationPoint, "type">> = [
  { id: "store-silom", name: "สาขาสีลม", lat: 13.7246, lng: 100.5347, address: "สีลม, บางรัก, กรุงเทพมหานคร", clusterId: "cluster-1", zoneHint: "กรุงเทพฯ" },
  { id: "store-sathorn", name: "สาขาสาทร", lat: 13.7192, lng: 100.5215, address: "สาทร, กรุงเทพมหานคร", clusterId: "cluster-1", zoneHint: "กรุงเทพฯ" },
  { id: "store-charoenkrung", name: "สาขาเจริญกรุง", lat: 13.7279, lng: 100.5142, address: "เจริญกรุง, บางรัก, กรุงเทพมหานคร", clusterId: "cluster-1", zoneHint: "กรุงเทพฯ" },
  { id: "store-pinklao", name: "สาขาปิ่นเกล้า", lat: 13.7789, lng: 100.4768, address: "ปิ่นเกล้า, บางกอกน้อย, กรุงเทพมหานคร", clusterId: "cluster-2", zoneHint: "กรุงเทพฯ" },
  { id: "store-bangkhae", name: "สาขาบางแค", lat: 13.7119, lng: 100.4071, address: "บางแค, กรุงเทพมหานคร", clusterId: "cluster-2", zoneHint: "กรุงเทพฯ" },
  { id: "store-ari", name: "สาขาอารีย์", lat: 13.7801, lng: 100.5446, address: "อารีย์, พญาไท, กรุงเทพมหานคร", clusterId: "cluster-3", zoneHint: "กรุงเทพฯ" },
  { id: "store-chatuchak", name: "สาขาจตุจักร", lat: 13.8022, lng: 100.5537, address: "จตุจักร, กรุงเทพมหานคร", clusterId: "cluster-3", zoneHint: "กรุงเทพฯ" },
  { id: "store-ladprao", name: "สาขาลาดพร้าว", lat: 13.8117, lng: 100.5612, address: "ลาดพร้าว, กรุงเทพมหานคร", clusterId: "cluster-3", zoneHint: "กรุงเทพฯ" },
  { id: "store-ratchada", name: "สาขารัชดา", lat: 13.7697, lng: 100.5734, address: "รัชดาภิเษก, ดินแดง, กรุงเทพมหานคร", clusterId: "cluster-4", zoneHint: "กรุงเทพฯ" },
  { id: "store-rama9", name: "สาขาพระราม 9", lat: 13.7579, lng: 100.565, address: "พระราม 9, ห้วยขวาง, กรุงเทพมหานคร", clusterId: "cluster-4", zoneHint: "กรุงเทพฯ" },
  { id: "store-thonglor", name: "สาขาทองหล่อ", lat: 13.7307, lng: 100.5826, address: "ทองหล่อ, วัฒนา, กรุงเทพมหานคร", clusterId: "cluster-5", zoneHint: "กรุงเทพฯ" },
  { id: "store-ekkamai", name: "สาขาเอกมัย", lat: 13.7199, lng: 100.5869, address: "เอกมัย, วัฒนา, กรุงเทพมหานคร", clusterId: "cluster-5", zoneHint: "กรุงเทพฯ" },
  { id: "store-onnut", name: "สาขาอ่อนนุช", lat: 13.7056, lng: 100.6013, address: "อ่อนนุช, สวนหลวง, กรุงเทพมหานคร", clusterId: "cluster-5", zoneHint: "กรุงเทพฯ" },
  { id: "store-bangna", name: "สาขาบางนา", lat: 13.6682, lng: 100.6047, address: "บางนา, กรุงเทพมหานคร", clusterId: "cluster-6", zoneHint: "กรุงเทพฯ" },
  { id: "store-minburi", name: "สาขามีนบุรี", lat: 13.813, lng: 100.7301, address: "มีนบุรี, กรุงเทพมหานคร", clusterId: "cluster-6", zoneHint: "กรุงเทพฯ" },

  { id: "store-nonthaburi", name: "สาขานนทบุรี", lat: 13.8621, lng: 100.5144, address: "เมืองนนทบุรี, นนทบุรี", clusterId: "cluster-7", zoneHint: "ปริมณฑล" },
  { id: "store-pakkret", name: "สาขาปากเกร็ด", lat: 13.9146, lng: 100.5034, address: "ปากเกร็ด, นนทบุรี", clusterId: "cluster-7", zoneHint: "ปริมณฑล" },
  { id: "store-rangsit", name: "สาขารังสิต", lat: 13.9896, lng: 100.6176, address: "รังสิต, ปทุมธานี", clusterId: "cluster-8", zoneHint: "ปริมณฑล" },
  { id: "store-lamlukka", name: "สาขาลำลูกกา", lat: 13.9327, lng: 100.7495, address: "ลำลูกกา, ปทุมธานี", clusterId: "cluster-8", zoneHint: "ปริมณฑล" },
  { id: "store-samutprakan", name: "สาขาสมุทรปราการ", lat: 13.5991, lng: 100.5998, address: "เมืองสมุทรปราการ, สมุทรปราการ", clusterId: "cluster-9", zoneHint: "ปริมณฑล" },
  { id: "store-phrapradaeng", name: "สาขาพระประแดง", lat: 13.6586, lng: 100.5331, address: "พระประแดง, สมุทรปราการ", clusterId: "cluster-9", zoneHint: "ปริมณฑล" },
  { id: "store-bangphli", name: "สาขาบางพลี", lat: 13.6066, lng: 100.7106, address: "บางพลี, สมุทรปราการ", clusterId: "cluster-9", zoneHint: "ปริมณฑล" },
  { id: "store-omnoi", name: "สาขาอ้อมน้อย", lat: 13.7053, lng: 100.3166, address: "กระทุ่มแบน, สมุทรสาคร", clusterId: "cluster-10", zoneHint: "ปริมณฑล" },
  { id: "store-mahachai", name: "สาขามหาชัย", lat: 13.5475, lng: 100.2744, address: "มหาชัย, สมุทรสาคร", clusterId: "cluster-10", zoneHint: "ปริมณฑล" },
  { id: "store-salaya", name: "สาขาศาลายา", lat: 13.7943, lng: 100.3217, address: "ศาลายา, นครปฐม", clusterId: "cluster-10", zoneHint: "ปริมณฑล" },

  { id: "store-ayutthaya", name: "สาขาอยุธยา", lat: 14.3532, lng: 100.5689, address: "พระนครศรีอยุธยา", clusterId: "cluster-11", zoneHint: "ภาคกลาง" },
  { id: "store-bangpain", name: "สาขาบางปะอิน", lat: 14.2278, lng: 100.5755, address: "บางปะอิน, พระนครศรีอยุธยา", clusterId: "cluster-11", zoneHint: "ภาคกลาง" },
  { id: "store-angthong", name: "สาขาอ่างทอง", lat: 14.5896, lng: 100.4551, address: "เมืองอ่างทอง, อ่างทอง", clusterId: "cluster-11", zoneHint: "ภาคกลาง" },
  { id: "store-saraburi", name: "สาขาสระบุรี", lat: 14.5289, lng: 100.9101, address: "เมืองสระบุรี, สระบุรี", clusterId: "cluster-12", zoneHint: "ภาคกลาง" },
  { id: "store-lopburi", name: "สาขาลพบุรี", lat: 14.7995, lng: 100.6534, address: "เมืองลพบุรี, ลพบุรี", clusterId: "cluster-12", zoneHint: "ภาคกลาง" },
  { id: "store-singburi", name: "สาขาสิงห์บุรี", lat: 14.8936, lng: 100.3967, address: "เมืองสิงห์บุรี, สิงห์บุรี", clusterId: "cluster-12", zoneHint: "ภาคกลาง" },
  { id: "store-suphanburi", name: "สาขาสุพรรณบุรี", lat: 14.4745, lng: 100.1177, address: "เมืองสุพรรณบุรี, สุพรรณบุรี", clusterId: "cluster-13", zoneHint: "ภาคกลาง" },
  { id: "store-nakhonpathom", name: "สาขานครปฐม", lat: 13.8199, lng: 100.0622, address: "เมืองนครปฐม, นครปฐม", clusterId: "cluster-13", zoneHint: "ภาคกลาง" },
  { id: "store-ratchaburi", name: "สาขาราชบุรี", lat: 13.5367, lng: 99.8171, address: "เมืองราชบุรี, ราชบุรี", clusterId: "cluster-14", zoneHint: "ภาคกลาง" },
  { id: "store-kanchanaburi", name: "สาขากาญจนบุรี", lat: 14.0228, lng: 99.5328, address: "เมืองกาญจนบุรี, กาญจนบุรี", clusterId: "cluster-14", zoneHint: "ภาคกลาง" },
  { id: "store-chainat", name: "สาขาชัยนาท", lat: 15.1864, lng: 100.1251, address: "เมืองชัยนาท, ชัยนาท", clusterId: "cluster-15", zoneHint: "ภาคกลาง" },
  { id: "store-samutsongkhram", name: "สาขาแม่กลอง", lat: 13.4146, lng: 100.0023, address: "แม่กลอง, สมุทรสงคราม", clusterId: "cluster-15", zoneHint: "ภาคกลาง" },

  { id: "store-chachoengsao", name: "สาขาฉะเชิงเทรา", lat: 13.6904, lng: 101.0779, address: "เมืองฉะเชิงเทรา, ฉะเชิงเทรา", clusterId: "cluster-16", zoneHint: "ภาคตะวันออก" },
  { id: "store-prachinburi", name: "สาขาปราจีนบุรี", lat: 14.0509, lng: 101.3722, address: "เมืองปราจีนบุรี, ปราจีนบุรี", clusterId: "cluster-16", zoneHint: "ภาคตะวันออก" },
  { id: "store-kabinburi", name: "สาขากบินทร์บุรี", lat: 13.9932, lng: 101.7176, address: "กบินทร์บุรี, ปราจีนบุรี", clusterId: "cluster-16", zoneHint: "ภาคตะวันออก" },
  { id: "store-chonburi", name: "สาขาชลบุรี", lat: 13.3611, lng: 100.9847, address: "เมืองชลบุรี, ชลบุรี", clusterId: "cluster-17", zoneHint: "ภาคตะวันออก" },
  { id: "store-sriracha", name: "สาขาศรีราชา", lat: 13.1737, lng: 100.9302, address: "ศรีราชา, ชลบุรี", clusterId: "cluster-17", zoneHint: "ภาคตะวันออก" },
  { id: "store-pattaya", name: "สาขาพัทยา", lat: 12.9236, lng: 100.8825, address: "พัทยา, ชลบุรี", clusterId: "cluster-17", zoneHint: "ภาคตะวันออก" },
  { id: "store-rayong", name: "สาขาระยอง", lat: 12.6814, lng: 101.2816, address: "เมืองระยอง, ระยอง", clusterId: "cluster-18", zoneHint: "ภาคตะวันออก" },
  { id: "store-banchang", name: "สาขาบ้านฉาง", lat: 12.7254, lng: 101.0553, address: "บ้านฉาง, ระยอง", clusterId: "cluster-18", zoneHint: "ภาคตะวันออก" },
  { id: "store-chanthaburi", name: "สาขาจันทบุรี", lat: 12.6113, lng: 102.1039, address: "เมืองจันทบุรี, จันทบุรี", clusterId: "cluster-19", zoneHint: "ภาคตะวันออก" },
  { id: "store-trat", name: "สาขาตราด", lat: 12.2428, lng: 102.5175, address: "เมืองตราด, ตราด", clusterId: "cluster-19", zoneHint: "ภาคตะวันออก" },

  { id: "store-korat", name: "สาขาโคราช", lat: 14.9799, lng: 102.0977, address: "เมืองนครราชสีมา, นครราชสีมา", clusterId: "cluster-20", zoneHint: "ภาคอีสาน" },
  { id: "store-pakchong", name: "สาขาปากช่อง", lat: 14.708, lng: 101.4161, address: "ปากช่อง, นครราชสีมา", clusterId: "cluster-20", zoneHint: "ภาคอีสาน" },
  { id: "store-chaiyaphum", name: "สาขาชัยภูมิ", lat: 15.8068, lng: 102.0315, address: "เมืองชัยภูมิ, ชัยภูมิ", clusterId: "cluster-20", zoneHint: "ภาคอีสาน" },
  { id: "store-buriram", name: "สาขาบุรีรัมย์", lat: 14.993, lng: 103.1029, address: "เมืองบุรีรัมย์, บุรีรัมย์", clusterId: "cluster-21", zoneHint: "ภาคอีสาน" },
  { id: "store-surin", name: "สาขาสุรินทร์", lat: 14.8829, lng: 103.4937, address: "เมืองสุรินทร์, สุรินทร์", clusterId: "cluster-21", zoneHint: "ภาคอีสาน" },
  { id: "store-khonkaen", name: "สาขาขอนแก่น", lat: 16.4419, lng: 102.835, address: "เมืองขอนแก่น, ขอนแก่น", clusterId: "cluster-22", zoneHint: "ภาคอีสาน" },
  { id: "store-mahasarakham", name: "สาขามหาสารคาม", lat: 16.1851, lng: 103.3026, address: "เมืองมหาสารคาม, มหาสารคาม", clusterId: "cluster-22", zoneHint: "ภาคอีสาน" },
  { id: "store-roiet", name: "สาขาร้อยเอ็ด", lat: 16.0538, lng: 103.652, address: "เมืองร้อยเอ็ด, ร้อยเอ็ด", clusterId: "cluster-22", zoneHint: "ภาคอีสาน" },
  { id: "store-udonthani", name: "สาขาอุดรธานี", lat: 17.4138, lng: 102.7872, address: "เมืองอุดรธานี, อุดรธานี", clusterId: "cluster-23", zoneHint: "ภาคอีสาน" },
  { id: "store-nongkhai", name: "สาขาหนองคาย", lat: 17.8783, lng: 102.7413, address: "เมืองหนองคาย, หนองคาย", clusterId: "cluster-23", zoneHint: "ภาคอีสาน" },
  { id: "store-loei", name: "สาขาเลย", lat: 17.486, lng: 101.7223, address: "เมืองเลย, เลย", clusterId: "cluster-23", zoneHint: "ภาคอีสาน" },
  { id: "store-ubon", name: "สาขาอุบลราชธานี", lat: 15.2287, lng: 104.8564, address: "เมืองอุบลราชธานี, อุบลราชธานี", clusterId: "cluster-24", zoneHint: "ภาคอีสาน" },
  { id: "store-yasothon", name: "สาขายโสธร", lat: 15.7941, lng: 104.1453, address: "เมืองยโสธร, ยโสธร", clusterId: "cluster-24", zoneHint: "ภาคอีสาน" },
  { id: "store-sakonnakhon", name: "สาขาสกลนคร", lat: 17.1546, lng: 104.1348, address: "เมืองสกลนคร, สกลนคร", clusterId: "cluster-25", zoneHint: "ภาคอีสาน" },
  { id: "store-nakhonphanom", name: "สาขานครพนม", lat: 17.4108, lng: 104.7784, address: "เมืองนครพนม, นครพนม", clusterId: "cluster-25", zoneHint: "ภาคอีสาน" }
];

const routeClusterAssignments: Record<string, string> = {
  "store-silom": "cluster-1",
  "store-sathorn": "cluster-1",
  "store-charoenkrung": "cluster-1",
  "store-thonglor": "cluster-1",
  "store-ekkamai": "cluster-1",
  "store-onnut": "cluster-1",
  "store-pinklao": "cluster-2",
  "store-bangkhae": "cluster-2",
  "store-ari": "cluster-2",
  "store-chatuchak": "cluster-2",
  "store-ladprao": "cluster-2",
  "store-ratchada": "cluster-2",
  "store-rama9": "cluster-2",
  "store-bangna": "cluster-3",
  "store-minburi": "cluster-3",
  "store-samutprakan": "cluster-3",
  "store-phrapradaeng": "cluster-3",
  "store-bangphli": "cluster-3",
  "store-nonthaburi": "cluster-4",
  "store-pakkret": "cluster-4",
  "store-rangsit": "cluster-4",
  "store-lamlukka": "cluster-4",
  "store-omnoi": "cluster-5",
  "store-mahachai": "cluster-5",
  "store-salaya": "cluster-5",
  "store-nakhonpathom": "cluster-5",
  "store-samutsongkhram": "cluster-5",
  "store-ayutthaya": "cluster-6",
  "store-bangpain": "cluster-6",
  "store-angthong": "cluster-6",
  "store-saraburi": "cluster-6",
  "store-lopburi": "cluster-6",
  "store-singburi": "cluster-6",
  "store-chainat": "cluster-6",
  "store-suphanburi": "cluster-7",
  "store-ratchaburi": "cluster-7",
  "store-kanchanaburi": "cluster-7",
  "store-chachoengsao": "cluster-8",
  "store-prachinburi": "cluster-8",
  "store-kabinburi": "cluster-8",
  "store-chonburi": "cluster-8",
  "store-sriracha": "cluster-8",
  "store-pattaya": "cluster-8",
  "store-rayong": "cluster-9",
  "store-banchang": "cluster-9",
  "store-chanthaburi": "cluster-9",
  "store-trat": "cluster-9",
  "store-korat": "cluster-10",
  "store-pakchong": "cluster-10",
  "store-chaiyaphum": "cluster-10",
  "store-buriram": "cluster-10",
  "store-surin": "cluster-10",
  "store-khonkaen": "cluster-11",
  "store-mahasarakham": "cluster-11",
  "store-roiet": "cluster-11",
  "store-ubon": "cluster-11",
  "store-yasothon": "cluster-11",
  "store-udonthani": "cluster-12",
  "store-nongkhai": "cluster-12",
  "store-loei": "cluster-12",
  "store-sakonnakhon": "cluster-12",
  "store-nakhonphanom": "cluster-12"
};

const fixedWindows: Array<[string, string]> = [
  ["08:30", "09:00"],
  ["09:00", "09:30"],
  ["10:00", "10:45"],
  ["11:00", "11:45"],
  ["13:00", "13:45"],
  ["15:00", "16:00"]
];

export const sampleLocations: LocationPoint[] = [
  {
    id: "depot-bkk",
    name: "ศูนย์กระจายสินค้ากรุงเทพ",
    type: "depot",
    lat: 13.7563,
    lng: 100.5018,
    address: "กรุงเทพมหานคร",
    zoneHint: "คลังหลัก"
  },
  ...sampleStoreSeeds.map((location) => ({
    ...location,
    clusterId: routeClusterAssignments[location.id] ?? location.clusterId,
    type: "store" as const,
    preferredDays: ["Mon", "Wed", "Fri"],
    serviceFrequency: "weekly" as const
  }))
];

export const sampleVehicles: Vehicle[] = [
  { id: "veh-1", name: "รถตู้ไฟฟ้า 01", capacityKg: 900, capacityCbm: 8, maxStops: 5, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: ["low-emission-only"] },
  { id: "veh-2", name: "รถบรรทุกตู้ทึบ 02", capacityKg: 1600, capacityCbm: 16, maxStops: 6, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-3", name: "รถบรรทุกตู้ทึบ 03", capacityKg: 1600, capacityCbm: 16, maxStops: 6, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-4", name: "รถบรรทุกตู้ทึบ 04", capacityKg: 1800, capacityCbm: 18, maxStops: 6, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-5", name: "รถ 6 ล้อ 05", capacityKg: 2600, capacityCbm: 24, maxStops: 7, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-6", name: "รถ 6 ล้อ 06", capacityKg: 2600, capacityCbm: 24, maxStops: 7, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-7", name: "รถ 6 ล้อ 07", capacityKg: 2800, capacityCbm: 26, maxStops: 7, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-8", name: "รถ 6 ล้อ 08", capacityKg: 2800, capacityCbm: 26, maxStops: 7, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-9", name: "รถ 10 ล้อ 09", capacityKg: 4500, capacityCbm: 36, maxStops: 8, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-10", name: "รถ 10 ล้อ 10", capacityKg: 4500, capacityCbm: 36, maxStops: 8, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-11", name: "รถร่วมภาคตะวันออก 11", capacityKg: 3200, capacityCbm: 28, maxStops: 7, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] },
  { id: "veh-12", name: "รถร่วมภาคอีสาน 12", capacityKg: 4200, capacityCbm: 34, maxStops: 8, startLocationId: "depot-bkk", endLocationId: "depot-bkk", restrictedZones: [] }
];

export const sampleOrders: Order[] = sampleStoreSeeds.map((location, index) => {
  const isFixed = index % 6 === 1 || index % 10 === 4;
  const [timeWindowStart, timeWindowEnd] = fixedWindows[index % fixedWindows.length];
  const regionalWeightBuffer = location.zoneHint === "ภาคอีสาน" ? 80 : location.zoneHint === "ภาคตะวันออก" ? 50 : 0;

  return {
    id: `ord-${String(1001 + index)}`,
    locationId: location.id,
    serviceDate: sampleServiceDate,
    timeMode: isFixed ? "fixed" : "flexible",
    weightKg: 120 + (index % 8) * 45 + regionalWeightBuffer,
    cbm: Number((0.8 + (index % 7) * 0.35).toFixed(1)),
    serviceMinutes: 15 + (index % 5) * 4,
    timeWindowStart: isFixed ? timeWindowStart : "",
    timeWindowEnd: isFixed ? timeWindowEnd : "",
    priority: index % 9 === 0 || isFixed ? "high" : "normal"
  };
});

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
