
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

interface CompanySettings {
    logoUrl?: string | null;
}

export interface CompanySettingsContextType {
  logoUrl: string | null;
  loading: boolean;
  updateLogo: (url: string | null) => Promise<void>;
}

export const CompanySettingsContext = createContext<CompanySettingsContextType | undefined>(undefined);

export function CompanySettingsProvider({ children }: { children: React.ReactNode }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const settingsRef = doc(db, 'settings', 'company');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as CompanySettings;
            setLogoUrl(data.logoUrl || null);
        } else {
            setLogoUrl(null);
        }
        setLoading(false);
    }, (error) => {
        console.error("Error fetching company settings: ", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const updateLogo = useCallback(async (url: string | null) => {
    const settingsRef = doc(db, 'settings', 'company');
    try {
        await setDoc(settingsRef, { logoUrl: url }, { merge: true });
        setLogoUrl(url);
    } catch(error) {
        console.error("Error updating logo:", error);
        throw error;
    }
  }, []);
  
  const value: CompanySettingsContextType = useMemo(() => ({
    logoUrl,
    loading,
    updateLogo,
  }), [logoUrl, loading, updateLogo]);

  return <CompanySettingsContext.Provider value={value}>{children}</CompanySettingsContext.Provider>;
}
