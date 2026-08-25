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
const individualMarkerZoom = 13;
const clusterMaxZoom = individualMarkerZoom - 1;
const locationClusterSourceId = "location-clusters";
const locationClusterLayerId = "location-cluster-circles";
const locationClusterCountLayerId = "location-cluster-count";
const locationUnclusteredLayerId = "location-unclustered";
const locationClusterInteractiveLayerIds = [locationClusterLayerId, locationClusterCountLayerId] as const;
const locationAccessSourceId = "location-access-constraints";
const locationAccessLayerId = "location-access-constraint-circles";

type BasemapContext = "buildings" | "places" | "pois";
type ClusterClickState = "ready" | "expanding" | "expanded" | "error";

function setBasemapContextVisibility(map: MapLibreMap, context: BasemapContext, visible: boolean) {
  map.getStyle().layers?.forEach((layer) => {
    const id = layer.id.toLowerCase();
    const sourceLayer = "source-layer" in layer && typeof layer["source-layer"] === "string" ? layer["source-layer"].toLowerCase() : "";
    const matches =
      context === "buildings"
        ? sourceLayer === "building" || id.includes("building")
        : context === "places"
          ? sourceLayer === "place" || id.startsWith("place_")
          : sourceLayer === "poi" || id.startsWith("poi");
    if (matches && map.getLayer(layer.id)) {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    }
  });
}

type VrpMapProps = {
  locations: LocationPoint[];
  allLocations?: LocationPoint[];
  orders: Order[];
  routes: RoutePlan[];
  scopeLabel?: string;
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
  const routeGeometryLegs = (route: RoutePlan) => {
    const geometry = route.geometry?.length ? route.geometry : route.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
    let cursor = 0;
    return route.stops.slice(1).map((stop, index) => {
      const previous = route.stops[index];
      let targetIndex = cursor + 1;
      let targetDistance = Number.POSITIVE_INFINITY;
      for (let geometryIndex = cursor; geometryIndex < geometry.length; geometryIndex += 1) {
        const distance = distanceKm(geometry[geometryIndex], stop);
        if (distance < targetDistance) {
          targetDistance = distance;
          targetIndex = geometryIndex;
        }
      }
      targetIndex = Math.max(cursor + 1, Math.min(targetIndex, geometry.length - 1));
      const segment = geometry.slice(cursor, targetIndex + 1);
      cursor = targetIndex;
      return {
        previous,
        stop,
        coordinates: segment.length >= 2 ? segment : [{ lat: previous.lat, lng: previous.lng }, { lat: stop.lat, lng: stop.lng }]
      };
    });
  };

  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) =>
      routeGeometryLegs(route).map(({ previous, stop, coordinates }) => {
        const impact = trafficLevelForLeg(previous, stop);
        return {
          type: "Feature" as const,
          properties: {
            color: impact.color,
            level: impact.level,
            label: impact.label,
            routeName: route.vehicleName,
            driveMinutes: Math.round(impact.driveMinutes),
            speedKmh: Math.round(impact.kmh),
            geometrySource: route.geometrySource ?? "unknown",
            approximate: route.geometrySource !== "google" && route.geometrySource !== "mapbox" && route.geometrySource !== "osrm"
          },
          geometry: {
            type: "LineString" as const,
            coordinates: coordinates.map((point) => [point.lng, point.lat])
          }
        };
      })
    )
  };
}

function fitMapToLocations(map: MapLibreMap, scopedLocations: LocationPoint[], duration = 600) {
  if (!scopedLocations.length) return;
  const first = scopedLocations[0];
  const bounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
  scopedLocations.forEach((location) => bounds.extend([location.lng, location.lat]));
  map.fitBounds(bounds as LngLatBoundsLike, { padding: 72, duration, maxZoom: 13 });
}

export function VrpMap({ locations, allLocations = locations, orders, routes, scopeLabel = "active scope", selectedLocationId, clusterColorByLocationId = {}, onLocationSelect, onLocationMove }: VrpMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Record<string, maplibregl.Marker>>({});
  const clusterHitMarkerRef = useRef<Record<string, maplibregl.Marker>>({});
  const lastAutoFitSignatureRef = useRef<string | undefined>(undefined);
  const lastFocusedLocationIdRef = useRef<string | undefined>(undefined);
  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(11);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const [showPois, setShowPois] = useState(true);
  const [showOperationalPoints, setShowOperationalPoints] = useState(true);
  const [showAccessConstraints, setShowAccessConstraints] = useState(true);
  const [clusterClickState, setClusterClickState] = useState<ClusterClickState>("ready");
  const [clusterLayerReady, setClusterLayerReady] = useState(false);
  const [renderedClusterCount, setRenderedClusterCount] = useState(0);
  const [showTrafficImpact, setShowTrafficImpact] = useState(false);
  const [showCityTraffic, setShowCityTraffic] = useState(false);
  const clusterClickInFlightRef = useRef(false);
  const hasApproximateRoutes = routes.some((route) => route.geometrySource !== "google" && route.geometrySource !== "mapbox" && route.geometrySource !== "osrm");

  const locationBoundsSignature = useMemo(() => {
    return locations
      .map((location) => `${location.id}:${location.lat.toFixed(6)}:${location.lng.toFixed(6)}`)
      .sort()
      .join("|");
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

  const storeLocationCount = useMemo(() => locations.filter((location) => location.type === "store").length, [locations]);

  const locationClusterData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: "FeatureCollection",
      features: locations
        .filter((location) => location.type === "store")
        .map((location) => ({
          type: "Feature" as const,
          properties: {
            id: location.id,
            name: location.name,
            color: routeStopByLocationId.get(location.id)?.color ?? clusterColorByLocationId[location.id] ?? storeMarkerColor
          },
          geometry: {
            type: "Point" as const,
            coordinates: [location.lng, location.lat]
          }
        }))
    }),
    [clusterColorByLocationId, locations, routeStopByLocationId]
  );

  const accessConstraintData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: "FeatureCollection",
      features: locations
        .filter((location) => location.vehicleRestriction?.trim())
        .map((location) => ({
          type: "Feature" as const,
          properties: {
            id: location.id,
            name: location.name,
            restriction: location.vehicleRestriction
          },
          geometry: {
            type: "Point" as const,
            coordinates: [location.lng, location.lat]
          }
        }))
    }),
    [locations]
  );

  const markerDensityMode = !showOperationalPoints ? "hidden" : storeLocationCount > 1 && mapZoom < individualMarkerZoom ? "clustered" : "individual";

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
    const handleZoomEnd = () => setMapZoom(map.getZoom());
    map.on("zoomend", handleZoomEnd);
    map.once("load", () => {
      setMapZoom(map.getZoom());
      setMapReady(true);
    });

    return () => {
      map.off("zoomend", handleZoomEnd);
      Object.values(markerRef.current).forEach((marker) => marker.remove());
      markerRef.current = {};
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      setMapZoom(11);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !locations.length || !mapReady || !locationBoundsSignature) return;
    if (lastAutoFitSignatureRef.current === locationBoundsSignature) return;

    lastAutoFitSignatureRef.current = locationBoundsSignature;
    fitMapToLocations(map, locations);
  }, [locationBoundsSignature, locations, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const applyBasemapContextVisibility = () => {
      setBasemapContextVisibility(map, "buildings", showBuildings);
      setBasemapContextVisibility(map, "places", showPlaces);
      setBasemapContextVisibility(map, "pois", showPois);
    };

    if (map.isStyleLoaded()) {
      applyBasemapContextVisibility();
    } else {
      map.once("load", applyBasemapContextVisibility);
    }

    return () => {
      map.off("load", applyBasemapContextVisibility);
    };
  }, [mapReady, showBuildings, showPlaces, showPois]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    Object.entries(markerRef.current).forEach(([id, marker]) => {
      if (!locations.some((location) => location.id === id)) {
        marker.remove();
        delete markerRef.current[id];
      }
    });

    locations.forEach((location) => {
      const routeStop = routeStopByLocationId.get(location.id);
      const orderSummary = orderSummaryByLocationId.get(location.id);
      const markerLabel = location.type === "depot" ? "D" : routeStop ? String(routeStop.sequence) : "";
      const markerColor = location.type === "depot" ? depotMarkerColor : routeStop?.color ?? clusterColorByLocationId[location.id] ?? storeMarkerColor;
      const locationType = location.type === "depot" ? "คลัง / จุดพักรถ" : "สาขา";
      const sequenceText =
        location.type === "depot"
          ? "จุดเริ่มต้น / จุดพัก / จุดกลับรถ"
          : routeStop
            ? `ลำดับส่งที่ ${routeStop.sequence}`
            : "จุดสาขาในข้อมูลของโครงการ";
      const routeText = routeStop ? `<span><b>รถ</b>${escapeHtml(routeStop.routeName)}</span>` : "";
      const orderText = routeStop?.orderIds.length ? `<span><b>ออเดอร์</b>${escapeHtml(routeStop.orderIds.join(", "))}</span>` : "";
      const arrivalText = routeStop ? `<span><b>ถึงประมาณ</b>${minutesToTime(routeStop.arrivalMinutes)}</span>` : "";
      const loadText = routeStop ? `<span><b>สะสมบนรถ</b>${Math.round(routeStop.loadKg)} กก., ${routeStop.loadCbm.toFixed(1)} CBM</span>` : "";
      const warningText = routeStop?.warnings.length ? `<span><b>เตือน</b>${escapeHtml(routeStop.warnings.join(", "))}</span>` : "";
      const addressText = location.address?.trim()
        ? `<span><b>ที่อยู่</b>${escapeHtml(location.address)}</span>`
        : "<span><b>ที่อยู่</b>ยังไม่ได้ระบุ</span>";
      const sourceText = "<span><b>แหล่งข้อมูล</b>ข้อมูลสาขาของโครงการ</span>";
      const accessText = location.vehicleRestriction?.trim()
        ? `<span><b>ข้อจำกัดรถ</b>${escapeHtml(location.vehicleRestriction)}</span>`
        : "";
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
      const statusChip = routeStop ? "อยู่ใน Route Plan" : orderSummary ? "มี Order วันนี้" : "ยังไม่มี Order วันนี้";
      const popupHtml = [
        `<div class="vrp-map-popup">`,
        `<header><div class="vrp-map-popup__title"><span class="vrp-map-popup__pin" style="background:${markerColor}"></span><strong>${escapeHtml(location.name)}</strong></div><span>${locationType} · ${sequenceText}</span><em>${statusChip}</em></header>`,
        `<section>`,
        `<span><b>รหัส</b>${escapeHtml(location.id)}</span>`,
        sourceText,
        addressText,
        accessText,
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
      const popup = new maplibregl.Popup({ offset: 18, closeButton: true }).setHTML(popupHtml);
      popup.on("close", () => {
        if (lastFocusedLocationIdRef.current === location.id) {
          lastFocusedLocationIdRef.current = undefined;
        }
      });
      const markerElement = document.createElement("div");
      markerElement.className = ["vrp-marker", location.type === "depot" ? "vrp-marker--depot" : "vrp-marker--store", selectedLocationId === location.id ? "vrp-marker--selected" : ""]
        .filter(Boolean)
        .join(" ");
      markerElement.style.backgroundColor = markerColor;
      markerElement.style.setProperty("--marker-color", markerColor);
      const markerShouldShow = showOperationalPoints && (location.type === "depot" || mapZoom >= individualMarkerZoom || selectedLocationId === location.id);
      markerElement.style.display = markerShouldShow ? "" : "none";
      markerElement.textContent = markerLabel;
      markerElement.setAttribute(
        "aria-label",
        `${location.name} ${location.type === "depot" ? "depot" : `stop ${markerLabel}`}`
      );

      const existing = markerRef.current[location.id];
      if (existing) {
        existing.setLngLat([location.lng, location.lat]);
        existing.setPopup(popup);
        existing.getElement().className = markerElement.className;
        existing.getElement().style.backgroundColor = markerColor;
        existing.getElement().style.setProperty("--marker-color", markerColor);
        existing.getElement().style.display = markerElement.style.display;
        existing.getElement().textContent = markerElement.textContent;
        existing.getElement().setAttribute("aria-label", markerElement.getAttribute("aria-label") ?? location.name);
        if (markerElement.style.display === "none") existing.getPopup()?.remove();
        existing.getElement().onclick = (event) => {
          event.stopPropagation();
          onLocationSelect?.(location.id);
          popup.setLngLat(existing.getLngLat()).addTo(map);
        };
        return;
      }

      const marker = new maplibregl.Marker({ element: markerElement, draggable: true, anchor: "center" })
        .setLngLat([location.lng, location.lat])
        .setPopup(popup)
        .addTo(map);

      markerElement.onclick = (event) => {
        event.stopPropagation();
        onLocationSelect?.(location.id);
        popup.setLngLat(marker.getLngLat()).addTo(map);
      };

      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onLocationMove(location.id, { lat: lngLat.lat, lng: lngLat.lng });
      });

      markerRef.current[location.id] = marker;
    });
  }, [clusterColorByLocationId, locations, mapReady, mapZoom, onLocationMove, onLocationSelect, orderSummaryByLocationId, routeStopByLocationId, selectedLocationId, showOperationalPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const renderLocationClusters = () => {
      const source = map.getSource(locationClusterSourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(locationClusterData);
      } else {
        map.addSource(locationClusterSourceId, {
          type: "geojson",
          data: locationClusterData,
          cluster: true,
          clusterMaxZoom,
          clusterRadius: 64
        });
      }

      if (!map.getLayer(locationClusterLayerId)) {
        map.addLayer({
          id: locationClusterLayerId,
          type: "circle",
          source: locationClusterSourceId,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#1B2E4B",
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 25, 28],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], clusterMaxZoom, 0.96, individualMarkerZoom, 0]
          }
        });
      }

      if (!map.getLayer(locationClusterCountLayerId)) {
        map.addLayer({
          id: locationClusterCountLayerId,
          type: "symbol",
          source: locationClusterSourceId,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Bold"],
            "text-size": 12,
            "text-allow-overlap": true
          },
          paint: {
            "text-color": "#ffffff",
            "text-opacity": ["interpolate", ["linear"], ["zoom"], clusterMaxZoom, 1, individualMarkerZoom, 0]
          }
        });
      }

      if (!map.getLayer(locationUnclusteredLayerId)) {
        map.addLayer({
          id: locationUnclusteredLayerId,
          type: "circle",
          source: locationClusterSourceId,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": 6,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
            "circle-opacity": ["interpolate", ["linear"], ["zoom"], clusterMaxZoom, 0.86, individualMarkerZoom, 0]
          }
        });
      }

      [locationClusterLayerId, locationClusterCountLayerId, locationUnclusteredLayerId].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", showOperationalPoints ? "visible" : "none");
        }
      });
    };

    const expandCluster = async (clusterId: number, coordinates: [number, number]) => {
      if (clusterClickInFlightRef.current) return;
      const source = map.getSource(locationClusterSourceId) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      clusterClickInFlightRef.current = true;
      setClusterClickState("expanding");
      try {
        const expansionZoom = await source.getClusterExpansionZoom(clusterId);
        if (mapRef.current !== map) return;
        const targetZoom = Math.min(Math.max(expansionZoom, map.getZoom() + 0.75), individualMarkerZoom + 1);
        map.easeTo({ center: coordinates, zoom: targetZoom, duration: 500 });
        setClusterClickState("expanded");
      } catch {
        setClusterClickState("error");
      } finally {
        clusterClickInFlightRef.current = false;
      }
    };
    const handleClusterClick = (event: maplibregl.MapMouseEvent) => {
      if (clusterClickInFlightRef.current) return;
      const features = map.queryRenderedFeatures(event.point, {
        layers: locationClusterInteractiveLayerIds.filter((layerId) => Boolean(map.getLayer(layerId)))
      });
      const feature = features.find((candidate) => typeof candidate.properties?.cluster_id === "number");
      const clusterId = feature?.properties?.cluster_id;
      if (typeof clusterId !== "number" || feature?.geometry.type !== "Point") return;
      void expandCluster(clusterId, feature.geometry.coordinates as [number, number]);
    };
    const handleClusterMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleClusterMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    const refreshClusterRenderState = () => {
      const layerIds = locationClusterInteractiveLayerIds.filter((layerId) => Boolean(map.getLayer(layerId)));
      const renderedFeatures = layerIds.length
        ? map.queryRenderedFeatures({ layers: layerIds })
        : [];
      const clusterIds = new Set(
        renderedFeatures
          .map((feature) => feature.properties?.cluster_id)
          .filter((clusterId): clusterId is number => typeof clusterId === "number")
      );
      setClusterLayerReady(layerIds.length === locationClusterInteractiveLayerIds.length);
      setRenderedClusterCount(clusterIds.size);
    };
    const syncClusterHitTargets = () => {
      if (!showOperationalPoints) {
        Object.values(clusterHitMarkerRef.current).forEach((marker) => marker.remove());
        clusterHitMarkerRef.current = {};
        return;
      }

      const layerIds = locationClusterInteractiveLayerIds.filter((layerId) => Boolean(map.getLayer(layerId)));
      const clusterFeatures = new Map<string, { clusterId: number; coordinates: [number, number]; count: string }>();
      if (layerIds.length) {
        map.queryRenderedFeatures({ layers: layerIds }).forEach((feature) => {
          if (feature.geometry.type !== "Point" || typeof feature.properties?.cluster_id !== "number") return;
          const clusterId = feature.properties.cluster_id;
          const coordinates = feature.geometry.coordinates as [number, number];
          clusterFeatures.set(String(clusterId), {
            clusterId,
            coordinates,
            count: String(feature.properties.point_count_abbreviated ?? feature.properties.point_count ?? "")
          });
        });
      }

      Object.entries(clusterHitMarkerRef.current).forEach(([key, marker]) => {
        if (!clusterFeatures.has(key)) {
          marker.remove();
          delete clusterHitMarkerRef.current[key];
        }
      });

      clusterFeatures.forEach(({ clusterId, coordinates, count }, key) => {
        const existing = clusterHitMarkerRef.current[key];
        if (existing) {
          existing.setLngLat(coordinates);
          existing.getElement().textContent = count;
          existing.getElement().setAttribute("aria-label", `ขยาย cluster ${count} จุด`);
          return;
        }

        const element = document.createElement("button");
        element.type = "button";
        element.className = "vrp-cluster-hit-target";
        element.textContent = count;
        element.setAttribute("aria-label", `ขยาย cluster ${count} จุด`);
        Object.assign(element.style, {
          alignItems: "center",
          background: "#1B2E4B",
          border: "2px solid #ffffff",
          borderRadius: "9999px",
          boxShadow: "0 4px 12px rgba(15, 23, 42, 0.24)",
          color: "#ffffff",
          cursor: "pointer",
          display: "flex",
          fontSize: "12px",
          fontWeight: "800",
          height: "36px",
          justifyContent: "center",
          padding: "0",
          width: "36px",
          zIndex: "40"
        });
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          void expandCluster(clusterId, coordinates);
        });
        const marker = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(coordinates)
          .addTo(map);
        marker.getElement().setAttribute("aria-label", `ขยาย cluster ${count} จุด`);
        clusterHitMarkerRef.current[key] = marker;
      });
    };

    const setupLocationClusters = () => {
      renderLocationClusters();
      locationClusterInteractiveLayerIds.forEach((layerId) => {
        if (!map.getLayer(layerId)) return;
        map.on("mouseenter", layerId, handleClusterMouseEnter);
        map.on("mouseleave", layerId, handleClusterMouseLeave);
      });
      map.on("click", handleClusterClick);
      refreshClusterRenderState();
      syncClusterHitTargets();
    };
    let clusterSetupComplete = false;
    const trySetupLocationClusters = () => {
      if (clusterSetupComplete || !map.isStyleLoaded()) return;
      clusterSetupComplete = true;
      if (clusterSetupRetryId !== undefined) window.clearInterval(clusterSetupRetryId);
      setupLocationClusters();
    };

    const clusterSetupRetryId = window.setInterval(trySetupLocationClusters, 250);
    if (map.isStyleLoaded()) trySetupLocationClusters();
    else {
      map.on("load", trySetupLocationClusters);
      map.on("idle", trySetupLocationClusters);
      map.on("styledata", trySetupLocationClusters);
    }
    map.on("idle", refreshClusterRenderState);
    map.on("idle", syncClusterHitTargets);
    map.on("moveend", refreshClusterRenderState);
    map.on("moveend", syncClusterHitTargets);

    return () => {
      map.off("load", trySetupLocationClusters);
      map.off("idle", trySetupLocationClusters);
      map.off("styledata", trySetupLocationClusters);
      if (clusterSetupRetryId !== undefined) window.clearInterval(clusterSetupRetryId);
      map.off("idle", refreshClusterRenderState);
      map.off("idle", syncClusterHitTargets);
      map.off("moveend", refreshClusterRenderState);
      map.off("moveend", syncClusterHitTargets);
      map.off("click", handleClusterClick);
      locationClusterInteractiveLayerIds.forEach((layerId) => {
        map.off("mouseenter", layerId, handleClusterMouseEnter);
        map.off("mouseleave", layerId, handleClusterMouseLeave);
      });
      Object.values(clusterHitMarkerRef.current).forEach((marker) => marker.remove());
      clusterHitMarkerRef.current = {};
      if (map.getCanvas()) map.getCanvas().style.cursor = "";
    };
  }, [locationClusterData, mapReady, showOperationalPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const renderAccessConstraints = () => {
      const source = map.getSource(locationAccessSourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(accessConstraintData);
      } else {
        map.addSource(locationAccessSourceId, { type: "geojson", data: accessConstraintData });
      }
      if (!map.getLayer(locationAccessLayerId)) {
        map.addLayer({
          id: locationAccessLayerId,
          type: "circle",
          source: locationAccessSourceId,
          paint: {
            "circle-color": "#D97706",
            "circle-radius": 8,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": 0.95
          }
        });
      }
      map.setLayoutProperty(locationAccessLayerId, "visibility", showAccessConstraints && accessConstraintData.features.length ? "visible" : "none");
    };
    const handleAccessConstraintClick = (event: maplibregl.MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: [locationAccessLayerId] })[0];
      if (!feature || feature.geometry.type !== "Point") return;
      const restriction = escapeHtml(String(feature.properties?.restriction ?? "ยังไม่ได้ระบุรายละเอียด"));
      const name = escapeHtml(String(feature.properties?.name ?? "จุดส่ง"));
      new maplibregl.Popup({ offset: 12, closeButton: true })
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setHTML(`<div class="vrp-map-popup"><header><strong>${name}</strong><em>ข้อจำกัดการเข้าถึง</em></header><section><span><b>ข้อจำกัดรถ</b>${restriction}</span></section></div>`)
        .addTo(map);
    };

    if (map.isStyleLoaded()) {
      renderAccessConstraints();
      map.on("click", locationAccessLayerId, handleAccessConstraintClick);
    } else {
      map.once("load", renderAccessConstraints);
    }

    return () => {
      map.off("load", renderAccessConstraints);
      map.off("click", locationAccessLayerId, handleAccessConstraintClick);
    };
  }, [accessConstraintData, mapReady, showAccessConstraints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedLocationId) return;
    if (lastFocusedLocationIdRef.current === selectedLocationId) return;

    const marker = markerRef.current[selectedLocationId];
    const target = marker?.getLngLat();
    if (!target) return;
    lastFocusedLocationIdRef.current = selectedLocationId;
    map.easeTo({
      center: [target.lng, target.lat],
      zoom: Math.max(map.getZoom(), 11.5),
      duration: 650
    });
    const popup = marker?.getPopup();
    if (marker && popup) {
      popup.setLngLat(marker.getLngLat()).addTo(map);
    }
  }, [mapReady, selectedLocationId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const renderRoutes = () => {
      routes.forEach((route) => {
        const sourceId = `route-${route.vehicleId}`;
        const casingLayerId = `route-casing-${route.vehicleId}`;
        const layerId = `route-line-${route.vehicleId}`;
        const isSimulatedGeometry = route.geometrySource !== "google" && route.geometrySource !== "mapbox" && route.geometrySource !== "osrm";
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
          if (map.getLayer(casingLayerId)) {
            map.setPaintProperty(casingLayerId, "line-dasharray", isSimulatedGeometry ? [2, 1] : [1, 0]);
            map.setPaintProperty(casingLayerId, "line-opacity", isSimulatedGeometry ? 0.08 : 0.14);
          }
          if (map.getLayer(layerId)) {
            map.setPaintProperty(layerId, "line-dasharray", isSimulatedGeometry ? [2, 1] : [1, 0]);
            map.setPaintProperty(layerId, "line-opacity", isSimulatedGeometry ? 0.62 : 0.85);
          }
        } else {
          map.addSource(sourceId, { type: "geojson", data: geojson });
          map.addLayer({
            id: casingLayerId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": route.color || fallbackRouteLineColor,
              "line-width": 8,
              "line-opacity": isSimulatedGeometry ? 0.08 : 0.14,
              "line-dasharray": isSimulatedGeometry ? [2, 1] : [1, 0],
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
              "line-opacity": isSimulatedGeometry ? 0.62 : 0.85,
              "line-dasharray": isSimulatedGeometry ? [2, 1] : [1, 0]
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
      <div className="pointer-events-auto absolute left-5 top-5 z-30 flex max-w-[calc(100%-6rem)] flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white/95 p-2 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur">
        <span className="px-2 text-[11px] font-semibold text-slate-500">ขอบเขต: {scopeLabel}</span>
        <span
          data-map-zoom={mapZoom.toFixed(2)}
          data-marker-density={markerDensityMode}
          data-cluster-layer-ready={clusterLayerReady ? "true" : "false"}
          data-rendered-cluster-count={renderedClusterCount}
          data-testid="marker-density-status"
          aria-live="polite"
          className="whitespace-nowrap rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600"
        >
          {markerDensityMode === "hidden"
            ? "ซ่อนจุดส่ง/คลัง"
            : markerDensityMode === "clustered"
              ? `รวม marker ${storeLocationCount} จุดตามระดับซูม · กดวงกลมเพื่อขยาย`
              : "แสดง marker รายจุด"}
        </span>
        <span
          data-cluster-click-state={clusterClickState}
          data-testid="cluster-click-status"
          aria-live="polite"
          className="whitespace-nowrap rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800"
        >
          {clusterClickState === "expanding"
            ? "กำลังขยาย cluster"
            : clusterClickState === "expanded"
              ? "ขยาย cluster แล้ว"
              : clusterClickState === "error"
                ? "ขยาย cluster ไม่สำเร็จ · ลองซูมเข้า"
                : "คลิกวงกลมหรือตัวเลข cluster เพื่อขยาย"}
        </span>
        <span
          data-testid="map-context-status"
          title="อาคารและสถานที่เป็นข้อมูลประกอบแผนที่; จุดส่งและคลังมาจากข้อมูลสาขาของโครงการ"
          className="whitespace-nowrap rounded-lg bg-[#F8FAFC] px-2 py-1 text-[11px] font-semibold text-slate-500"
        >
          บริบท: อาคาร {showBuildings ? "เปิด" : "ปิด"} · สถานที่ {showPlaces && showPois ? "เปิด" : "ปิด"} · จุดส่ง {showOperationalPoints ? "เปิด" : "ปิด"}
        </span>
        <span
          data-testid="map-access-status"
          className="whitespace-nowrap rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
        >
          {accessConstraintData.features.length ? `ข้อจำกัดรถ ${accessConstraintData.features.length} จุด` : "ยังไม่มีข้อมูลข้อจำกัดรถ"}
        </span>
        <button
          type="button"
          aria-pressed={showBuildings}
          onClick={() => setShowBuildings((current) => !current)}
          title="อาคารจาก basemap ไม่ใช่ข้อมูลทางเข้าอาคารที่ยืนยันแล้ว"
          className={
            showBuildings
              ? "h-9 rounded-lg bg-primary px-3 text-[11px] font-bold text-primary-foreground"
              : "h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary"
          }
        >
          อาคาร
        </button>
        <button
          type="button"
          aria-pressed={showPlaces && showPois}
          onClick={() => {
            const next = !(showPlaces && showPois);
            setShowPlaces(next);
            setShowPois(next);
          }}
          title="ชื่อสถานที่และ POI จาก basemap"
          className={
            showPlaces && showPois
              ? "h-9 rounded-lg bg-primary px-3 text-[11px] font-bold text-primary-foreground"
              : "h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary"
          }
        >
          สถานที่/POI
        </button>
        <button
          type="button"
          aria-pressed={showOperationalPoints}
          onClick={() => setShowOperationalPoints((current) => !current)}
          title="จุดส่งและคลังจากข้อมูลสาขาของโครงการ"
          className={
            showOperationalPoints
              ? "h-9 rounded-lg bg-primary px-3 text-[11px] font-bold text-primary-foreground"
              : "h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary"
          }
        >
          จุดส่ง/คลัง
        </button>
        <button
          type="button"
          aria-pressed={showAccessConstraints}
          disabled={!accessConstraintData.features.length}
          onClick={() => setShowAccessConstraints((current) => !current)}
          title={accessConstraintData.features.length ? "แสดงจุดที่มีข้อจำกัดรถจากข้อมูลสาขาของโครงการ" : "ชุดข้อมูลนี้ยังไม่มีข้อจำกัดรถที่ระบุไว้"}
          className={
            showAccessConstraints && accessConstraintData.features.length
              ? "h-9 rounded-lg bg-amber-600 px-3 text-[11px] font-bold text-white"
              : "h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          ข้อจำกัดรถ
        </button>
        <button
          type="button"
          disabled={!locations.length}
          onClick={() => {
            if (mapRef.current) fitMapToLocations(mapRef.current, locations);
          }}
          className="h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
        >
          ซูมจุดในขอบเขต
        </button>
        <button
          type="button"
          disabled={!allLocations.length}
          onClick={() => {
            if (mapRef.current) fitMapToLocations(mapRef.current, allLocations);
          }}
          className="h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
        >
          ดูทุกจุด
        </button>
        <button
          type="button"
          onClick={() => mapRef.current?.easeTo({ center: [100.5018, 13.7563], zoom: 11, duration: 500 })}
          className="h-9 rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 text-[11px] font-bold text-primary hover:bg-secondary"
        >
          รีเซ็ตมุมมอง
        </button>
        <button
          type="button"
          disabled={!routes.length}
          onClick={() => setShowTrafficImpact((current) => !current)}
          className={
            showTrafficImpact
              ? "h-10 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground"
              : "h-10 rounded-lg border border-slate-200 bg-[#F8FAFC] px-4 text-xs font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
          }
        >
          สีตาม route
        </button>
        <button
          type="button"
          disabled={!mapboxTrafficToken}
          onClick={() => setShowCityTraffic((current) => !current)}
          className={
            showCityTraffic
              ? "h-10 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground"
              : "h-10 rounded-lg border border-slate-200 bg-[#F8FAFC] px-4 text-xs font-bold text-primary hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-45"
          }
          title={mapboxTrafficToken ? "แสดงสภาพจราจรในเมืองจาก Mapbox" : "ต้องตั้งค่า NEXT_PUBLIC_MAPBOX_TOKEN เพื่อเปิดสภาพจราจรในเมือง"}
        >
          จราจรในเมือง
        </button>
        <span className="whitespace-nowrap px-2 text-[11px] font-semibold text-slate-500">
          {showTrafficImpact || showCityTraffic ? (showTrafficImpact && hasApproximateRoutes ? "ประมาณการจราจร" : "จราจรเปิด") : "จราจรปิด"}
        </span>
      </div>
    </div>
  );
}
