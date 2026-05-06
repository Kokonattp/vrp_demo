"use client";

import maplibregl, { LngLatBoundsLike, Map } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import type { Coordinate, LocationPoint, RoutePlan } from "@/types/vrp";

const osmStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

type VrpMapProps = {
  locations: LocationPoint[];
  routes: RoutePlan[];
  selectedLocationId?: string;
  onLocationMove: (id: string, coordinate: Coordinate) => void;
};

export function VrpMap({ locations, routes, selectedLocationId, onLocationMove }: VrpMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Record<string, maplibregl.Marker>>({});

  const bounds = useMemo(() => {
    if (!locations.length) return undefined;
    const first = locations[0];
    const lngLatBounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
    locations.forEach((location) => lngLatBounds.extend([location.lng, location.lat]));
    return lngLatBounds;
  }, [locations]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: [100.5018, 13.7563],
      zoom: 11,
      attributionControl: false
    });
    mapRef.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    map.fitBounds(bounds as LngLatBoundsLike, { padding: 72, duration: 600, maxZoom: 13 });
  }, [bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.entries(markerRef.current).forEach(([id, marker]) => {
      if (!locations.some((location) => location.id === id)) {
        marker.remove();
        delete markerRef.current[id];
      }
    });

    locations.forEach((location) => {
      const markerElement = document.createElement("div");
      markerElement.className = [
        "grid h-8 w-8 place-items-center rounded-full border-2 text-xs font-bold shadow-lg",
        location.type === "depot" ? "border-slate-900 bg-white text-slate-900" : "border-white bg-primary text-white",
        selectedLocationId === location.id ? "ring-4 ring-accent/60" : ""
      ].join(" ");
      markerElement.textContent = location.type === "depot" ? "D" : location.name.slice(0, 1).toUpperCase();

      const existing = markerRef.current[location.id];
      if (existing) {
        existing.setLngLat([location.lng, location.lat]);
        existing.setPopup(new maplibregl.Popup().setHTML(`<strong>${location.name}</strong><br/>${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`));
        existing.getElement().className = markerElement.className;
        existing.getElement().textContent = markerElement.textContent;
        return;
      }

      const marker = new maplibregl.Marker({ element: markerElement, draggable: true })
        .setLngLat([location.lng, location.lat])
        .setPopup(new maplibregl.Popup().setHTML(`<strong>${location.name}</strong><br/>${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`))
        .addTo(map);

      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onLocationMove(location.id, { lat: lngLat.lat, lng: lngLat.lng });
      });

      markerRef.current[location.id] = marker;
    });
  }, [locations, onLocationMove, selectedLocationId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const renderRoutes = () => {
      routes.forEach((route) => {
        const sourceId = `route-${route.vehicleId}`;
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
            id: layerId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": route.color,
              "line-width": 5,
              "line-opacity": 0.86
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
        if (layer.id.startsWith("route-line-")) {
          const vehicleId = layer.id.replace("route-line-", "");
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
  }, [routes]);

  return <div ref={containerRef} className="h-full min-h-[520px] w-full overflow-hidden rounded-none bg-muted" />;
}
