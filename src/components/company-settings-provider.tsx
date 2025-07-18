

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { type PricingParameters, type ProfitRange } from '@/types';

interface CompanySettings {
    labelSizeId?: string | null;
    pricingParameters?: PricingParameters;
}

export interface CompanySettingsContextType {
  labelSizeId: string | null;
  pricingParameters: PricingParameters | null;
  loading: boolean;
  updateLabelSize: (sizeId: string | null) => Promise<void>;
  updatePricingParameters: (params: PricingParameters) => Promise<void>;
}

export const CompanySettingsContext = createContext<CompanySettingsContextType | undefined>(undefined);

const defaultPricingParameters: PricingParameters = {
  defaultOperationPercentage: 15,
  profitRanges: [
    { id: '1', from: -Infinity, to: 0, color: 'text-destructive' },
    { id: '2', from: 0, to: 30, color: 'text-orange-500' },
    { id: '3', from: 30, to: 50, color: 'text-yellow-500' },
    { id: '4', from: 50, to: Infinity, color: 'text-green-600' },
  ],
};

export function CompanySettingsProvider({ children }: { children: React.ReactNode }) {
  const [labelSizeId, setLabelSizeId] = useState<string | null>('6080');
  const [pricingParameters, setPricingParameters] = useState<PricingParameters | null>(defaultPricingParameters);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const settingsRef = doc(db, 'settings', 'company');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as CompanySettings;
            setLabelSizeId(data.labelSizeId || '6080');
            setPricingParameters(data.pricingParameters || defaultPricingParameters);
        } else {
            // If doc doesn't exist, create it with defaults
            setDoc(settingsRef, {
                labelSizeId: '6080',
                pricingParameters: defaultPricingParameters,
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
        await updateDoc(settingsRef, { 'labelSizeId': sizeId });
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
  
  const value: CompanySettingsContextType = useMemo(() => ({
    labelSizeId,
    pricingParameters,
    loading,
    updateLabelSize,
    updatePricingParameters,
  }), [labelSizeId, pricingParameters, loading, updateLabelSize, updatePricingParameters]);

  return <CompanySettingsContext.Provider value={value}>{children}</CompanySettingsContext.Provider>;
}
