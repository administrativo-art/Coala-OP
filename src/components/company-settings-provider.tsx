
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { type PricingParameters } from '@/types';

interface CompanySettings {
    labelSizeId?: string | null;
    pricingParameters?: PricingParameters;
    purchasingDefaults?: {
      goodsAccountPlanId?: string | null;
      freightAccountPlanId?: string | null;
    };
}

export interface CompanySettingsContextType {
  labelSizeId: string | null;
  pricingParameters: PricingParameters | null;
  purchasingDefaults: {
    goodsAccountPlanId: string | null;
    freightAccountPlanId: string | null;
  };
  loading: boolean;
  updateLabelSize: (sizeId: string | null) => Promise<void>;
  updatePricingParameters: (params: PricingParameters) => Promise<void>;
  updatePurchasingDefaults: (defaults: {
    goodsAccountPlanId: string | null;
    freightAccountPlanId: string | null;
  }) => Promise<void>;
}

export const CompanySettingsContext = createContext<CompanySettingsContextType | undefined>(undefined);

const defaultPricingParameters: PricingParameters = {
  averageTaxPercentage: 0,
  averageCardFeePercentage: 0,
  profitGoals: [45, 50, 55, 60, 65],
  profitRanges: [
    { id: '1', from: 50, to: Infinity, color: 'text-green-600' },
    { id: '2', from: 45, to: 50, color: 'text-yellow-600' },
    { id: '3', from: 0, to: 45, color: 'text-destructive' },
  ],
};

export function CompanySettingsProvider({ children }: { children: React.ReactNode }) {
  const [labelSizeId, setLabelSizeId] = useState<string | null>('6080');
  const [pricingParameters, setPricingParameters] = useState<PricingParameters | null>(defaultPricingParameters);
  const [purchasingDefaults, setPurchasingDefaults] = useState({
    goodsAccountPlanId: null as string | null,
    freightAccountPlanId: null as string | null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      const settingsRef = doc(db, 'settings', 'company');
      const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
          if (docSnap.exists()) {
              const data = docSnap.data() as CompanySettings;
              setLabelSizeId(data.labelSizeId || '6080');
              
              const params = data.pricingParameters || {};
              const validatedParams: PricingParameters = {
                  ...defaultPricingParameters,
                  ...params,
                  profitRanges: (data.pricingParameters?.profitRanges && data.pricingParameters.profitRanges.length > 0)
                      ? data.pricingParameters.profitRanges
                      : defaultPricingParameters.profitRanges,
              };
              setPricingParameters(validatedParams);
              setPurchasingDefaults({
                goodsAccountPlanId: data.purchasingDefaults?.goodsAccountPlanId ?? null,
                freightAccountPlanId: data.purchasingDefaults?.freightAccountPlanId ?? null,
              });
          } else {
              // If doc doesn't exist, create it with defaults
              setDoc(settingsRef, {
                  labelSizeId: '6080',
                  pricingParameters: defaultPricingParameters,
                  purchasingDefaults: {
                    goodsAccountPlanId: null,
                    freightAccountPlanId: null,
                  },
              });
          }
          setLoading(false);
      }, (error) => {
          console.error("Error fetching company settings: ", error);
          setLoading(false);
      });

      return () => unsubscribe();
    });

    return () => unsubAuth();
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
        // Use setDoc with merge: true to ensure the document exists and fields are correctly updated
        await setDoc(settingsRef, { 'pricingParameters': params }, { merge: true });
    } catch (error) {
        console.error("Error updating pricing parameters:", error);
        throw error;
    }
  }, []);

  const updatePurchasingDefaults = useCallback(async (defaults: {
    goodsAccountPlanId: string | null;
    freightAccountPlanId: string | null;
  }) => {
    const settingsRef = doc(db, 'settings', 'company');
    try {
      await setDoc(settingsRef, { purchasingDefaults: defaults }, { merge: true });
    } catch (error) {
      console.error("Error updating purchasing defaults:", error);
      throw error;
    }
  }, []);
  
  const value: CompanySettingsContextType = useMemo(() => ({
    labelSizeId,
    pricingParameters,
    purchasingDefaults,
    loading,
    updateLabelSize,
    updatePricingParameters,
    updatePurchasingDefaults,
  }), [labelSizeId, pricingParameters, purchasingDefaults, loading, updateLabelSize, updatePricingParameters, updatePurchasingDefaults]);

  return <CompanySettingsContext.Provider value={value}>{children}</CompanySettingsContext.Provider>;
}
