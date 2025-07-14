
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

interface CompanySettings {
    labelSizeId?: string | null;
}

export interface CompanySettingsContextType {
  labelSizeId: string | null;
  loading: boolean;
  updateLabelSize: (sizeId: string | null) => Promise<void>;
}

export const CompanySettingsContext = createContext<CompanySettingsContextType | undefined>(undefined);

export function CompanySettingsProvider({ children }: { children: React.ReactNode }) {
  const [labelSizeId, setLabelSizeId] = useState<string | null>('6080'); // Default to a common size
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const settingsRef = doc(db, 'settings', 'company');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as CompanySettings;
            setLabelSizeId(data.labelSizeId || '6080');
        } else {
            setLabelSizeId('6080');
        }
        setLoading(false);
    }, (error) => {
        console.error("Error fetching company settings: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const updateLabelSize = useCallback(async (sizeId: string | null) => {
    const settingsRef = doc(db, 'settings', 'company');
    try {
        await setDoc(settingsRef, { labelSizeId: sizeId }, { merge: true });
        setLabelSizeId(sizeId);
    } catch (error) {
        console.error("Error updating label size:", error);
        throw error;
    }
  }, []);
  
  const value: CompanySettingsContextType = useMemo(() => ({
    labelSizeId,
    loading,
    updateLabelSize,
  }), [labelSizeId, loading, updateLabelSize]);

  return <CompanySettingsContext.Provider value={value}>{children}</CompanySettingsContext.Provider>;
}
