"use client";

import maplibregl, { LngLatBoundsLike, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Coordinate, LocationPoint, Order, RoutePlan } from "@/types/vrp";

const mapStyle = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const fallbackRouteLineColor = "#1B2E4B";
const depotMarkerColor = "#1B2E4B";
const storeMarkerColor = "#EF4444";
const trafficColors = {
  fast: "#16A34A",
  slow: "#D97706",
  jam: "#DC2626"
};
const cityTrafficColors = {
  low: "#22C55E",
  moderate: "#F59E0B",
  heavy: "#EF4444",
  severe: "#7F1D1D"
};
const mapboxTrafficToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() ?? "";

type VrpMapProps = {
  locations: LocationPoint[];
  orders: Order[];
  routes: RoutePlan[];
  selectedLocationId?: string;
  clusterColorByLocationId?: Record<string, string>;
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

function trafficLevelForLeg(previous: RoutePlan["stops"][number], current: RoutePlan["stops"][number]) {
  const driveMinutes = Math.max(1, current.arrivalMinutes - previous.arrivalMinutes - previous.serviceMinutes);
  const km = distanceKm(previous, current);
  const kmh = (km / driveMinutes) * 60;
  if (current.warnings.some((warning) => /เวลา|Time window|late/i.test(warning)) || kmh < 25) {
    return { level: "jam" as const, color: trafficColors.jam, label: "ช้ามาก", driveMinutes, kmh };
  }
  if (kmh < 38) return { level: "slow" as const, color: trafficColors.slow, label: "หน่วง", driveMinutes, kmh };
  return { level: "fast" as const, color: trafficColors.fast, label: "คล่องตัว", driveMinutes, kmh };
}

function buildTrafficFeatures(routes: RoutePlan[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) =>
      route.stops.slice(1).map((stop, index) => {
        const previous = route.stops[index];
        const impact = trafficLevelForLeg(previous, stop);
        return {
          type: "Feature" as const,
          properties: {
            color: impact.color,
            level: impact.level,
            label: impact.label,
            routeName: route.vehicleName,
            driveMinutes: Math.round(impact.driveMinutes),
            speedKmh: Math.round(impact.kmh)
          },
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [previous.lng, previous.lat],
              [stop.lng, stop.lat]
            ]
          }
        };
      })
    )
  };
}

export function VrpMap({ locations, orders, routes, selectedLocationId, clusterColorByLocationId = {}, onLocationSelect, onLocationMove }: VrpMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Record<string, maplibregl.Marker>>({});
  const [mapReady, setMapReady] = useState(false);
  const [showTrafficImpact, setShowTrafficImpact] = useState(false);
  const [showCityTraffic, setShowCityTraffic] = useState(false);

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
      const markerColor = location.type === "depot" ? depotMarkerColor : routeStop?.color ?? clusterColorByLocationId[location.id] ?? storeMarkerColor;
      const locationType = location.type === "depot" ? "คลังสินค้า" : "สาขา";
      const sequenceText =
        location.type === "depot"
          ? "จุดเริ่มต้น/จุดกลับคลัง"
          : routeStop
            ? `ลำดับส่งที่ ${routeStop.sequence}`
            : `ตำแหน่งที่ ${fallbackSequence}`;
      const routeText = routeStop ? `<span><b>รถ</b>${escapeHtml(routeStop.routeName)}</span>` : "";
      const orderText = routeStop?.orderIds.length ? `<span><b>ออเดอร์</b>${escapeHtml(routeStop.orderIds.join(", "))}</span>` : "";
      const arrivalText = routeStop ? `<span><b>ถึงประมาณ</b>${minutesToTime(routeStop.arrivalMinutes)}</span>` : "";
      const loadText = routeStop ? `<span><b>สะสมบนรถ</b>${Math.round(routeStop.loadKg)} กก., ${routeStop.loadCbm.toFixed(1)} CBM</span>` : "";
      const warningText = routeStop?.warnings.length ? `<span><b>เตือน</b>${escapeHtml(routeStop.warnings.join(", "))}</span>` : "";
      const addressText = location.address?.trim()
        ? `<span><b>ที่อยู่</b>${escapeHtml(location.address)}</span>`
        : "<span><b>ที่อยู่</b>ยังไม่ได้ระบุ</span>";
      const serviceDates = orderSummary ? Array.from(new Set(orderSummary.serviceDates.filter(Boolean))) : [];
      const timeWindows = orderSummary ? Array.from(new Set(orderSummary.timeWindows.filter(Boolean))) : [];
      const orderSummaryText = orderSummary
        ? `<span><b>ปริมาณงาน</b>${orderSummary.count} ออเดอร์</span><span><b>น้ำหนัก/CBM</b>${Math.round(orderSummary.weightKg)} กก. · ${orderSummary.cbm.toFixed(1)} CBM</span>`
        : "";
      const serviceDateText = orderSummary
        ? `<span><b>วันที่งานส่ง</b>${escapeHtml(serviceDates.join(", ") || "-")}</span>`
        : "";
      const serviceText = orderSummary
        ? `<span><b>เวลาบริการ</b>${orderSummary.serviceMinutes} นาที</span><span><b>เวลาเข้า</b>${
            orderSummary.hasFixedTime
              ? escapeHtml(timeWindows.join(", ") || "-")
              : "ยืดหยุ่น ให้ระบบเลือกช่วงเหมาะสม"
          }</span>`
        : "";
      const priorityText = orderSummary
        ? `<span><b>ความด่วน</b>${orderSummary.priorities.has("high") ? "ด่วน" : "ปกติ"}</span>`
        : "";
      const popupHtml = [
        `<div class="vrp-map-popup">`,
        `<header><strong>${escapeHtml(location.name)}</strong><span>${locationType} · ${sequenceText}</span></header>`,
        `<section>`,
        `<span><b>รหัส</b>${escapeHtml(location.id)}</span>`,
        addressText,
        `<span><b>พิกัด</b>${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}</span>`,
        `</section>`,
        orderSummary ? `<section>` : "",
        serviceDateText,
        orderSummaryText,
        serviceText,
        priorityText,
        orderSummary ? `</section>` : "",
        routeStop ? `<section>` : "",
        routeText,
        orderText,
        arrivalText,
        loadText,
        warningText,
        routeStop ? `</section>` : "",
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
  }, [clusterColorByLocationId, locations, mapReady, onLocationMove, onLocationSelect, orderSummaryByLocationId, routeStopByLocationId, selectedLocationId]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = "city-traffic";
    const layerId = "city-traffic-line";
    const removeCityTraffic = () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };

    if (!showCityTraffic || !mapboxTrafficToken) {
      removeCityTraffic();
      return;
    }

    const renderCityTraffic = () => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: "vector",
          tiles: [`https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1/{z}/{x}/{y}.mvt?access_token=${mapboxTrafficToken}`],
          minzoom: 0,
          maxzoom: 22
        });
      }
      if (!map.getLayer(layerId)) {
        const firstRouteLayer = map.getStyle().layers?.find((layer) => layer.id.startsWith("route-casing-"))?.id;
        map.addLayer(
          {
            id: layerId,
            type: "line",
            source: sourceId,
            "source-layer": "traffic",
            paint: {
              "line-color": [
                "match",
                ["get", "congestion"],
                "low",
                cityTrafficColors.low,
                "moderate",
                cityTrafficColors.moderate,
                "heavy",
                cityTrafficColors.heavy,
                "severe",
                cityTrafficColors.severe,
                "closed",
                cityTrafficColors.severe,
                "rgba(100,116,139,0)"
              ],
              "line-opacity": 0.78,
              "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 12, 1.8, 15, 3, 18, 5],
              "line-blur": 0.25
            },
            layout: {
              "line-cap": "round",
              "line-join": "round"
            }
          },
          firstRouteLayer
        );
      }
    };

    if (map.isStyleLoaded()) {
      renderCityTraffic();
    } else {
      map.once("load", renderCityTraffic);
    }

    return () => {
      if (!showCityTraffic) removeCityTraffic();
    };
  }, [mapReady, showCityTraffic]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = "traffic-impact";
    const casingLayerId = "traffic-impact-casing";
    const layerId = "traffic-impact-line";
    const geojson = buildTrafficFeatures(routes);

    const removeTrafficLayer = () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };

    if (!showTrafficImpact || !geojson.features.length) {
      removeTrafficLayer();
      return;
    }

    const renderTrafficLayer = () => {
      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(geojson);
        return;
      }

      map.addSource(sourceId, { type: "geojson", data: geojson });
      map.addLayer({
        id: casingLayerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ffffff",
          "line-width": 10,
          "line-opacity": 0.9
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
          "line-color": ["get", "color"],
          "line-width": 5.5,
          "line-opacity": 0.95
        },
        layout: {
          "line-cap": "round",
          "line-join": "round"
        }
      });
    };

    if (map.isStyleLoaded()) {
      renderTrafficLayer();
    } else {
      map.once("load", renderTrafficLayer);
    }

    return () => {
      if (!showTrafficImpact) removeTrafficLayer();
    };
  }, [mapReady, routes, showTrafficImpact]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-muted">
      <div ref={containerRef} className="h-full min-h-0 w-full" />
      <div className="pointer-events-auto absolute left-5 top-5 z-30 rounded-2xl border border-slate-300 bg-white/95 p-3 shadow-[0_16px_40px_rgba(15,23,42,0.14)] backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!routes.length}
              onClick={() => setShowTrafficImpact((current) => !current)}
              className={
                showTrafficImpact
                  ? "rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
                  : "rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-xs font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
              }
            >
              Route
            </button>
            <button
              type="button"
              disabled={!mapboxTrafficToken}
              onClick={() => setShowCityTraffic((current) => !current)}
              className={
                showCityTraffic
                  ? "rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
                  : "rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-xs font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
              }
              title={mapboxTrafficToken ? "Show Mapbox city traffic" : "Set NEXT_PUBLIC_MAPBOX_TOKEN to enable city traffic"}
            >
              City
            </button>
          </div>
          <span className="text-[11px] font-semibold text-slate-500">{showTrafficImpact || showCityTraffic ? "Traffic ON" : "Traffic OFF"}</span>
        </div>
        {!mapboxTrafficToken && (
          <p className="mb-2 max-w-[220px] text-[11px] leading-relaxed text-amber-700">
            City traffic ต้องตั้ง NEXT_PUBLIC_MAPBOX_TOKEN
          </p>
        )}
        {(showTrafficImpact || showCityTraffic) && (
          <div className="grid gap-1 text-[11px] text-slate-700">
            {showTrafficImpact && (
              <p className="font-bold text-primary">Route traffic</p>
            )}
            {showCityTraffic && (
              <p className="font-bold text-primary">City traffic</p>
            )}
            {showTrafficImpact && (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: trafficColors.fast }} />
                  <span>Route คล่องตัว</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: trafficColors.slow }} />
                  <span>Route หน่วง</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: trafficColors.jam }} />
                  <span>Route ช้ามาก / late</span>
                </div>
              </>
            )}
            {showCityTraffic && (
              <>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: cityTrafficColors.low }} />
                  <span>City low</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: cityTrafficColors.moderate }} />
                  <span>City moderate</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: cityTrafficColors.heavy }} />
                  <span>City heavy</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: cityTrafficColors.severe }} />
                  <span>City severe</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
