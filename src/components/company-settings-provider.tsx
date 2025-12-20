
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { type PricingParameters } from '@/types';

interface CompanySettings {
    labelSizeId?: string | null;
    pricingParameters?: PricingParameters;
    logoUrl?: string;
}

export interface CompanySettingsContextType {
  labelSizeId: string | null;
  pricingParameters: PricingParameters | null;
  logoUrl: string | null;
  loading: boolean;
  updateLabelSize: (sizeId: string | null) => Promise<void>;
  updatePricingParameters: (params: PricingParameters) => Promise<void>;
  updateLogoUrl: (url: string | null) => Promise<void>;
}

export const CompanySettingsContext = createContext<CompanySettingsContextType | undefined>(undefined);

const defaultPricingParameters: PricingParameters = {
  defaultOperationPercentage: 15,
  profitGoals: [45, 50, 55, 60, 65],
  profitRanges: [
    { id: '1', from: 50, to: Infinity, color: 'text-green-600' },
    { id: '2', from: 45, to: 50, color: 'text-yellow-600' },
    { id: '3', from: 0, to: 45, color: 'text-destructive' },
  ],
};

const defaultLogoUrl = "https://firebasestorage.googleapis.com/v0/b/smart-converter-752gf.appspot.com/o/settings%2Fcompany%2F01%20Logo%20-%20Coala%20Shakes.png?alt=media&token=182d597b-61e0-4f86-aaa1-ac85b2ce2c6f";

export function CompanySettingsProvider({ children }: { children: React.ReactNode }) {
  const [labelSizeId, setLabelSizeId] = useState<string | null>('6080');
  const [pricingParameters, setPricingParameters] = useState<PricingParameters | null>(defaultPricingParameters);
  const [logoUrl, setLogoUrl] = useState<string | null>(defaultLogoUrl);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const settingsRef = doc(db, 'settings', 'company');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as CompanySettings;
            setLabelSizeId(data.labelSizeId || '6080');
            setLogoUrl(data.logoUrl || defaultLogoUrl);
            
            const params = data.pricingParameters || {};
            // Ensure defaults for new fields if they don't exist
            const validatedParams: PricingParameters = {
                ...defaultPricingParameters,
                ...params,
                profitRanges: params.profitRanges && params.profitRanges.length > 0 ? params.profitRanges : defaultPricingParameters.profitRanges,
            };
            setPricingParameters(validatedParams);
        } else {
            // If doc doesn't exist, create it with defaults
            setDoc(settingsRef, {
                labelSizeId: '6080',
                pricingParameters: defaultPricingParameters,
                logoUrl: defaultLogoUrl,
            });
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
        await updateDoc(settingsRef, { 'labelSizeId': sizeId ?? null });
    } catch (error) {
        console.error("Error updating label size:", error);
        throw error;
    }
  }, []);
  
  const updatePricingParameters = useCallback(async (params: PricingParameters) => {
    const settingsRef = doc(db, 'settings', 'company');
    try {
        await updateDoc(settingsRef, { 'pricingParameters': params });
    } catch (error) {
        console.error("Error updating pricing parameters:", error);
        throw error;
    }
  }, []);

  const updateLogoUrl = useCallback(async (url: string | null) => {
    const settingsRef = doc(db, 'settings', 'company');
    try {
        await updateDoc(settingsRef, { logoUrl: url ?? null });
    } catch (error) {
        console.error("Error updating logo URL:", error);
        throw error;
    }
  }, []);
  
  const value: CompanySettingsContextType = useMemo(() => ({
    labelSizeId,
    pricingParameters,
    logoUrl,
    loading,
    updateLabelSize,
    updatePricingParameters,
    updateLogoUrl,
  }), [labelSizeId, pricingParameters, logoUrl, loading, updateLabelSize, updatePricingParameters, updateLogoUrl]);

  return <CompanySettingsContext.Provider value={value}>{children}</CompanySettingsContext.Provider>;
}
