"use client";

import { AlertTriangle, CheckCircle2, MapPin, Navigation, Package, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { decodeDriverPayload, DriverRoutePayload, minutesToClock } from "@/lib/driver-payload";

export default function DriverRoutePage() {
  const [payload, setPayload] = useState<DriverRoutePayload | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hash = window.location.hash.replace(/^#data=/, "");
      setPayload(hash ? decodeDriverPayload(hash) : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const deliveryStops = useMemo(() => payload?.stops.filter((stop) => stop.orderId) ?? [], [payload]);

  if (!payload) {
    return (
      <main className="min-h-screen bg-[#F8FAFC] p-5 text-primary">
        <div className="mx-auto max-w-md rounded-[14px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
          <AlertTriangle className="mb-3 h-6 w-6 text-amber-500" />
          <h1 className="text-lg font-bold">ไม่พบข้อมูลงานส่ง</h1>
          <p className="mt-2 text-sm text-muted-foreground">ลิงก์นี้ไม่มีข้อมูล route หรือ QR อาจไม่สมบูรณ์</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-primary">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[14px] text-white" style={{ backgroundColor: payload.color }}>
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold">{payload.vehicleName}</h1>
            <p className="text-xs text-muted-foreground">
              {payload.planningDate} · {deliveryStops.length} จุดส่ง · {payload.distanceKm.toFixed(1)} กม.
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-md space-y-3 p-4">
        <div className="grid grid-cols-3 gap-2">
          <RouteStat label="เวลา" value={`${payload.durationMinutes} นาที`} />
          <RouteStat label="น้ำหนัก" value={`${Math.round(payload.loadKg)} กก.`} />
          <RouteStat label="CBM" value={payload.loadCbm.toFixed(1)} />
        </div>

        {payload.stops.map((stop, index) => {
          const isDepot = !stop.orderId;
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;
          return (
            <article key={`${stop.locationId}-${index}`} className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
              <div className="flex items-start gap-3">
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: isDepot ? "#1B2E4B" : payload.color }}
                >
                  {isDepot ? "D" : stop.sequence}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-bold">{stop.name}</h2>
                      <p className="text-xs text-muted-foreground">{isDepot ? "คลังสินค้า" : `ออเดอร์ ${stop.orderId}`}</p>
                    </div>
                    <span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold">{minutesToClock(stop.arrivalMinutes)}</span>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                    {stop.address && (
                      <p className="flex gap-2">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{stop.address}</span>
                      </p>
                    )}
                    {stop.timeWindow && <p>ช่วงส่ง: {stop.timeWindow}</p>}
                    {!isDepot && (
                      <p>
                        ปริมาณสะสม: {Math.round(stop.loadKg)} กก. · {stop.loadCbm.toFixed(1)} CBM · บริการ {stop.serviceMinutes} นาที
                      </p>
                    )}
                    {stop.warnings.length > 0 && <p className="text-amber-600">เตือน: {stop.warnings.join(", ")}</p>}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white"
                    >
                      <Navigation className="h-4 w-4" />
                      นำทาง
                    </a>
                    <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      ส่งแล้ว
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function RouteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-3 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <Package className="mb-2 h-4 w-4 text-accent" />
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
