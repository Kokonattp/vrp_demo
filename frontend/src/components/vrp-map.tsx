"use client";

import maplibregl, { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Coordinate, LocationPoint, Order, RoutePlan } from "@/types/vrp";

const mapStyle = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const fallbackRouteLineColor = "#1B2E4B";
const depotMarkerColor = "#1B2E4B";
const storeMarkerColor = "#EF4444";

type VrpMapProps = {
  locations: LocationPoint[];
  orders: Order[];
  routes: RoutePlan[];
  selectedLocationId?: string;
  onLocationSelect?: (id: string) => void;
  onLocationMove: (id: string, coordinate: Coordinate) => void;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

function minutesToTime(value: number) {
  const normalized = Math.max(0, Math.round(value));
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function VrpMap({ locations, orders, routes, selectedLocationId, onLocationSelect, onLocationMove }: VrpMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Record<string, maplibregl.Marker>>({});
  const [mapReady, setMapReady] = useState(false);

  const bounds = useMemo(() => {
    if (!locations.length) return undefined;
    const first = locations[0];
    const lngLatBounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
    locations.forEach((location) => lngLatBounds.extend([location.lng, location.lat]));
    return lngLatBounds;
  }, [locations]);

  const routeStopByLocationId = useMemo(() => {
    const stopsByLocation = new Map<
      string,
      {
        routeName: string;
        color: string;
        sequence: number;
        orderIds: string[];
        arrivalMinutes: number;
        loadKg: number;
        loadCbm: number;
        warnings: string[];
      }
    >();

    routes.forEach((route) => {
      let deliverySequence = 0;
      route.stops.forEach((stop) => {
        if (!stop.orderId) return;
        deliverySequence += 1;
        const existing = stopsByLocation.get(stop.locationId);
        if (existing) {
          existing.orderIds.push(stop.orderId);
          existing.loadKg += stop.loadKg;
          existing.loadCbm += stop.loadCbm;
          existing.warnings.push(...stop.warnings);
          return;
        }
        stopsByLocation.set(stop.locationId, {
          routeName: route.vehicleName,
          color: route.color,
          sequence: deliverySequence,
          orderIds: [stop.orderId],
          arrivalMinutes: stop.arrivalMinutes,
          loadKg: stop.loadKg,
          loadCbm: stop.loadCbm,
          warnings: [...stop.warnings]
        });
      });
    });

    return stopsByLocation;
  }, [routes]);

  const orderSummaryByLocationId = useMemo(() => {
    const summaryByLocation = new Map<
      string,
      {
        count: number;
        weightKg: number;
        cbm: number;
        serviceMinutes: number;
        serviceDates: string[];
        timeWindows: string[];
        hasFixedTime: boolean;
        priorities: Set<Order["priority"]>;
      }
    >();

    orders.forEach((order) => {
      const existing = summaryByLocation.get(order.locationId);
      if (existing) {
        existing.count += 1;
        existing.weightKg += order.weightKg;
        existing.cbm += order.cbm;
        existing.serviceMinutes += order.serviceMinutes;
        existing.serviceDates.push(order.serviceDate);
        if (order.timeMode === "fixed") existing.timeWindows.push(`${order.timeWindowStart}-${order.timeWindowEnd}`);
        existing.hasFixedTime = existing.hasFixedTime || order.timeMode === "fixed";
        existing.priorities.add(order.priority);
        return;
      }
      summaryByLocation.set(order.locationId, {
        count: 1,
        weightKg: order.weightKg,
        cbm: order.cbm,
        serviceMinutes: order.serviceMinutes,
        serviceDates: [order.serviceDate],
        timeWindows: order.timeMode === "fixed" ? [`${order.timeWindowStart}-${order.timeWindowEnd}`] : [],
        hasFixedTime: order.timeMode === "fixed",
        priorities: new Set([order.priority])
      });
    });

    return summaryByLocation;
  }, [orders]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: [100.5018, 13.7563],
      zoom: 11,
      attributionControl: false
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.once("load", () => setMapReady(true));

    return () => {
      Object.values(markerRef.current).forEach((marker) => marker.remove());
      markerRef.current = {};
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds || !mapReady) return;
    map.fitBounds(bounds as LngLatBoundsLike, { padding: 72, duration: 600, maxZoom: 13 });
  }, [bounds, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    Object.entries(markerRef.current).forEach(([id, marker]) => {
      if (!locations.some((location) => location.id === id)) {
        marker.remove();
        delete markerRef.current[id];
      }
    });

    locations.forEach((location, index) => {
      const routeStop = routeStopByLocationId.get(location.id);
      const orderSummary = orderSummaryByLocationId.get(location.id);
      const fallbackSequence = locations.slice(0, index + 1).filter((item) => item.type === "store").length;
      const markerLabel = location.type === "depot" ? "D" : String(routeStop?.sequence ?? fallbackSequence);
      const markerColor = location.type === "depot" ? depotMarkerColor : routeStop?.color ?? storeMarkerColor;
      const locationType = location.type === "depot" ? "คลังสินค้า" : "สาขา";
      const sequenceText =
        location.type === "depot"
          ? "จุดเริ่มต้น/จุดกลับคลัง"
          : routeStop
            ? `ลำดับส่งที่ ${routeStop.sequence}`
            : `ตำแหน่งที่ ${fallbackSequence}`;
      const routeText = routeStop ? `<br/><span>รถ: ${escapeHtml(routeStop.routeName)}</span>` : "";
      const orderText = routeStop?.orderIds.length ? `<br/><span>ออเดอร์: ${escapeHtml(routeStop.orderIds.join(", "))}</span>` : "";
      const arrivalText = routeStop ? `<br/><span>ถึงประมาณ: ${minutesToTime(routeStop.arrivalMinutes)}</span>` : "";
      const loadText = routeStop ? `<br/><span>ปริมาณสะสมบนรถ: ${Math.round(routeStop.loadKg)} กก., ${routeStop.loadCbm.toFixed(1)} CBM</span>` : "";
      const warningText = routeStop?.warnings.length ? `<br/><span>เตือน: ${escapeHtml(routeStop.warnings.join(", "))}</span>` : "";
      const addressText = location.address ? `<span>${escapeHtml(location.address)}</span>` : "<span>ไม่ได้ระบุที่อยู่</span>";
      const orderSummaryText = orderSummary
        ? `<span>ปริมาณงาน: ${orderSummary.count} ออเดอร์ · ${Math.round(orderSummary.weightKg)} กก. · ${orderSummary.cbm.toFixed(1)} CBM</span>`
        : "";
      const serviceDateText = orderSummary
        ? `<span>วันที่งานส่ง: ${escapeHtml(Array.from(new Set(orderSummary.serviceDates)).join(", "))}</span>`
        : "";
      const serviceText = orderSummary
        ? `<span>เวลาบริการ: ${orderSummary.serviceMinutes} นาที · ${
            orderSummary.hasFixedTime
              ? `ช่วงส่ง: ${escapeHtml(Array.from(new Set(orderSummary.timeWindows)).join(", "))}`
              : "ยืดหยุ่น: ระบบเลือกช่วงที่เหมาะกับ route"
          }</span>`
        : "";
      const priorityText = orderSummary
        ? `<span>ระดับ: ${orderSummary.priorities.has("high") ? "ด่วน" : "ปกติ"}</span>`
        : "";
      const popupHtml = [
        `<div class="vrp-map-popup">`,
        `<strong>${escapeHtml(location.name)}</strong>`,
        `<span>${locationType} · ${sequenceText}</span>`,
        `<span>รหัส: ${escapeHtml(location.id)}</span>`,
        addressText,
        serviceDateText,
        orderSummaryText,
        serviceText,
        priorityText,
        routeText.replace("<br/>", ""),
        orderText.replace("<br/>", ""),
        arrivalText.replace("<br/>", ""),
        loadText.replace("<br/>", ""),
        warningText.replace("<br/>", ""),
        `<span>พิกัด: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}</span>`,
        `</div>`
      ].join("");
      const markerElement = document.createElement("div");
      markerElement.className = ["vrp-marker", location.type === "depot" ? "vrp-marker--depot" : "vrp-marker--store", selectedLocationId === location.id ? "vrp-marker--selected" : ""]
        .filter(Boolean)
        .join(" ");
      markerElement.style.backgroundColor = markerColor;
      markerElement.style.setProperty("--marker-color", markerColor);
      markerElement.textContent = markerLabel;
      markerElement.setAttribute(
        "aria-label",
        `${location.name} ${location.type === "depot" ? "depot" : `stop ${markerLabel}`}`
      );
      markerElement.onclick = () => onLocationSelect?.(location.id);

      const existing = markerRef.current[location.id];
      if (existing) {
        existing.setLngLat([location.lng, location.lat]);
        existing.setPopup(new maplibregl.Popup().setHTML(popupHtml));
        existing.getElement().className = markerElement.className;
        existing.getElement().style.backgroundColor = markerColor;
        existing.getElement().style.setProperty("--marker-color", markerColor);
        existing.getElement().textContent = markerElement.textContent;
        existing.getElement().setAttribute("aria-label", markerElement.getAttribute("aria-label") ?? location.name);
        existing.getElement().onclick = () => onLocationSelect?.(location.id);
        return;
      }

      const marker = new maplibregl.Marker({ element: markerElement, draggable: true, anchor: "center" })
        .setLngLat([location.lng, location.lat])
        .setPopup(new maplibregl.Popup().setHTML(popupHtml))
        .addTo(map);

      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onLocationMove(location.id, { lat: lngLat.lat, lng: lngLat.lng });
      });

      markerRef.current[location.id] = marker;
    });
  }, [locations, mapReady, onLocationMove, onLocationSelect, orderSummaryByLocationId, routeStopByLocationId, selectedLocationId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const renderRoutes = () => {
      routes.forEach((route) => {
        const sourceId = `route-${route.vehicleId}`;
        const casingLayerId = `route-casing-${route.vehicleId}`;
        const layerId = `route-line-${route.vehicleId}`;
        const coordinates = route.geometry.map((point) => [point.lng, point.lat]);
        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates
          }
        };

        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
        if (source) {
          source.setData(geojson);
        } else {
          map.addSource(sourceId, { type: "geojson", data: geojson });
          map.addLayer({
            id: casingLayerId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": route.color || fallbackRouteLineColor,
              "line-width": 8,
              "line-opacity": 0.14,
              "line-blur": 6
            },
            layout: {
              "line-cap": "round",
              "line-join": "round"
            }
          });
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": route.color || fallbackRouteLineColor,
              "line-width": 4,
              "line-opacity": 0.85
            },
            layout: {
              "line-cap": "round",
              "line-join": "round"
            }
          });
        }
      });

      const activeIds = new Set(routes.map((route) => route.vehicleId));
      map.getStyle().layers?.forEach((layer) => {
        if (layer.id.startsWith("route-line-") || layer.id.startsWith("route-casing-")) {
          const vehicleId = layer.id.replace("route-line-", "").replace("route-casing-", "");
          if (!activeIds.has(vehicleId) && map.getLayer(layer.id)) {
            map.removeLayer(layer.id);
          }
        }
      });
      Object.keys((map.getStyle().sources ?? {}) as Record<string, unknown>).forEach((sourceId) => {
        if (sourceId.startsWith("route-")) {
          const vehicleId = sourceId.replace("route-", "");
          if (!activeIds.has(vehicleId) && map.getSource(sourceId)) {
            map.removeSource(sourceId);
          }
        }
      });
    };

    if (map.isStyleLoaded()) {
      renderRoutes();
    } else {
      map.once("load", renderRoutes);
    }
  }, [mapReady, routes]);

  return <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden bg-muted" />;
}
