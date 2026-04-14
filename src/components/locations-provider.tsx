
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type Location } from '@/types';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, query } from "firebase/firestore";

export interface LocationsContextType {
  locations: Location[];
  loading: boolean;
  addLocation: (location: Omit<Location, 'id'>) => Promise<void>;
  updateLocation: (location: Location) => Promise<void>;
  deleteLocation: (locationId: string) => Promise<void>;
}

export const LocationsContext = createContext<LocationsContextType | undefined>(undefined);

export function LocationsProvider({ children }: { children: React.ReactNode }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLocations([]);
        setLoading(false);
        return;
      }

      const q = query(collection(db, "locations"));
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const locationsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Location));
        setLocations(locationsData);
        setLoading(false);
      }, (error) => {
          console.error("Error fetching locations from Firestore: ", error);
          setLoading(false);
      });

      return () => unsubscribe();
    });

    return () => unsubAuth();
  }, []);
  
  const addLocation = useCallback(async (locationData: Omit<Location, 'id'>) => {
    try {
        await addDoc(collection(db, "locations"), locationData);
    } catch(error) {
        console.error("Error adding location:", error);
    }
  }, []);

  const updateLocation = useCallback(async (updatedLocation: Location) => {
    const locationRef = doc(db, "locations", updatedLocation.id);
    const { id, ...dataToUpdate } = updatedLocation;
     try {
        await updateDoc(locationRef, dataToUpdate);
    } catch(error) {
        console.error("Error updating location:", error);
    }
  }, []);
  
  const deleteLocation = useCallback(async (locationId: string) => {
    try {
        await deleteDoc(doc(db, "locations", locationId));
    } catch(error) {
        console.error("Error deleting location:", error);
        throw error;
    }
  }, []);
  
  const value: LocationsContextType = useMemo(() => ({
    locations,
    loading,
    addLocation,
    updateLocation,
    deleteLocation,
  }), [locations, loading, addLocation, updateLocation, deleteLocation]);

  return <LocationsContext.Provider value={value}>{children}</LocationsContext.Provider>;
}
