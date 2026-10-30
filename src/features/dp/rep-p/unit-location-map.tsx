"use client";

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Loader2, MapPin } from "lucide-react";

type Point = { latitude: number; longitude: number };

let configuredKey: string | null = null;
let mapsPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string) {
  if (mapsPromise && configuredKey === apiKey) return mapsPromise;
  configuredKey = apiKey;
  setOptions({ key: apiKey, v: "weekly", language: "pt-BR", region: "BR" });
  mapsPromise = Promise.all([importLibrary("maps"), importLibrary("places")]).then(() => undefined);
  return mapsPromise;
}

/** Busca oficial do Google, mapa da área e pino ajustável; a chave é pública e restrita por site no Cloud Console. */
export function UnitLocationMap({ apiKey, center, radiusMeters, onPoint, onAddress }: {
  apiKey: string | null; center: Point | null; radiusMeters: number; onPoint: (point: Point) => void;
  onAddress: (address: string) => void;
}) {
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjectRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const callbacksRef = useRef({ onPoint, onAddress });
  const centerRef = useRef(center);
  const radiusRef = useRef(radiusMeters);
  const [loading, setLoading] = useState(Boolean(apiKey));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { callbacksRef.current = { onPoint, onAddress }; }, [onPoint, onAddress]);
  useEffect(() => { centerRef.current = center; radiusRef.current = radiusMeters; }, [center, radiusMeters]);

  useEffect(() => {
    if (!apiKey || !autocompleteRef.current || !mapRef.current) {
      return;
    }
    let cancelled = false;
    let marker: google.maps.Marker | null = null;
    let circle: google.maps.Circle | null = null;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | null = null;
    const listeners: google.maps.MapsEventListener[] = [];
    setLoading(true); setError(null);
    void loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !mapRef.current || !autocompleteRef.current) return;
      const initial = centerRef.current ?? { latitude: -2.5307, longitude: -44.3068 };
      const position = { lat: initial.latitude, lng: initial.longitude };
      const map = new google.maps.Map(mapRef.current, { center: position, zoom: centerRef.current ? 18 : 12,
        streetViewControl: false, mapTypeControl: false, fullscreenControl: false, clickableIcons: false });
      marker = new google.maps.Marker({ map, position, draggable: true, title: "Local da unidade" });
      circle = new google.maps.Circle({ map, center: position, radius: radiusRef.current, clickable: false,
        fillColor: "#D13670", fillOpacity: 0.14, strokeColor: "#D13670", strokeOpacity: 0.8, strokeWeight: 2 });
      mapObjectRef.current = map; markerRef.current = marker; circleRef.current = circle;
      const applyPosition = (lat: number, lng: number, zoom = false) => {
        const next = { lat, lng };
        marker?.setPosition(next); circle?.setCenter(next);
        if (zoom) { map.setCenter(next); map.setZoom(18); }
        callbacksRef.current.onPoint({ latitude: lat, longitude: lng });
      };
      listeners.push(marker.addListener("dragend", () => {
        const next = marker?.getPosition(); if (next) applyPosition(next.lat(), next.lng());
      }));
      listeners.push(map.addListener("click", (event: google.maps.MapMouseEvent) => {
        if (event.latLng) applyPosition(event.latLng.lat(), event.latLng.lng());
      }));

      autocomplete = new google.maps.places.PlaceAutocompleteElement({ includedRegionCodes: ["br"] });
      autocomplete.placeholder = "Busque o endereço ou o nome do local";
      autocomplete.className = "block w-full";
      const select = async (event: google.maps.places.PlacePredictionSelectEvent) => {
        try {
          const place = event.placePrediction.toPlace();
          await place.fetchFields({ fields: ["displayName", "formattedAddress", "location", "viewport"] });
          if (!place.location) return;
          const lat = place.location.lat(); const lng = place.location.lng();
          applyPosition(lat, lng, !place.viewport);
          if (place.viewport) map.fitBounds(place.viewport);
          callbacksRef.current.onAddress(place.formattedAddress ?? place.displayName ?? "");
        } catch { setError("Não foi possível carregar o local escolhido."); }
      };
      autocomplete.addEventListener("gmp-select", select);
      autocompleteRef.current.replaceChildren(autocomplete);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setLoading(false); setError("Não foi possível carregar o Google Maps."); } });
    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      marker?.setMap(null); circle?.setMap(null);
      mapObjectRef.current = null; markerRef.current = null; circleRef.current = null;
      autocomplete?.remove();
    };
  }, [apiKey]);

  useEffect(() => {
    circleRef.current?.setRadius(radiusMeters);
    if (!center || !mapObjectRef.current) return;
    const position = { lat: center.latitude, lng: center.longitude };
    markerRef.current?.setPosition(position); circleRef.current?.setCenter(position);
  }, [center, radiusMeters]);

  const visibleError = error ?? (!apiKey ? "A chave do Google Maps não está disponível neste ambiente." : null);

  return <div className="space-y-2">
    <div ref={autocompleteRef} className="min-h-12 rounded-ds-btn border border-ds-border-input bg-ds-surface p-1" />
    <div className="relative overflow-hidden rounded-ds-card border border-ds-border bg-ds-warm">
      <div ref={mapRef} className="h-64 w-full" aria-label="Mapa da área da unidade" />
      {loading ? <div className="absolute inset-0 grid place-items-center bg-ds-warm/80"><Loader2 className="h-6 w-6 animate-spin text-ds-accent-ink" /></div> : null}
      {!loading && visibleError ? <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs font-semibold text-ds-warn">
        <span><MapPin className="mx-auto mb-2 h-5 w-5" aria-hidden />{visibleError}</span></div> : null}
    </div>
    <p className="text-xs text-ds-ink-muted">Busque um lugar, clique no mapa ou arraste o pino. O círculo representa o raio configurado.</p>
  </div>;
}
