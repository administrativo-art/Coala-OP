"use client";

import { useState, useEffect, useCallback } from 'react';
import { type Location } from '@/types';

const STORAGE_KEY = 'smart-converter-locations';

export function useLocations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const items = window.localStorage.getItem(STORAGE_KEY);
      if (items) {
        setLocations(JSON.parse(items));
      } else {
        const defaultLocations: Location[] = [
            { id: '1', name: 'Depósito Principal' },
            { id: '2', name: 'Loja A' },
        ];
        setLocations(defaultLocations);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultLocations));
      }
    } catch (error) {
      console.error('Failed to load locations from localStorage', error);
    } finally {
        setLoading(false);
    }
  }, []);

  const saveLocations = useCallback((newLocations: Location[]) => {
    try {
      setLocations(newLocations);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newLocations));
    } catch (error) {
      console.error('Failed to save locations to localStorage', error);
    }
  }, []);

  const addLocation = useCallback((locationName: string) => {
    if (locationName && !locations.find(l => l.name.toLowerCase() === locationName.toLowerCase())) {
        const newLocation = { name: locationName, id: new Date().toISOString() };
        saveLocations([...locations, newLocation]);
    }
  }, [locations, saveLocations]);
  
  const updateLocation = useCallback((updatedLocation: Location) => {
    const newLocations = locations.map(l => l.id === updatedLocation.id ? updatedLocation : l);
    saveLocations(newLocations);
  }, [locations, saveLocations]);

  const deleteLocation = useCallback((locationId: string) => {
    const newLocations = locations.filter(l => l.id !== locationId);
    saveLocations(newLocations);
  }, [locations, saveLocations]);

  return { locations, loading, addLocation, updateLocation, deleteLocation };
}
