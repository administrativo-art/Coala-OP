

"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import { type BaseProduct } from '@/types';
import { db } from '@/lib/firebase';
import { fetchClientBootstrap } from '@/lib/client-bootstrap';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { normalizeMeasurementUnit } from '@/lib/conversion';

export interface BaseProductsContextType {
  baseProducts: BaseProduct[];
  loading: boolean;
  addBaseProduct: (product: Omit<BaseProduct, 'id'>) => Promise<void>;
  updateBaseProduct: (product: BaseProduct) => Promise<void>;
  updateMultipleBaseProducts: (products: BaseProduct[]) => Promise<void>;
  deleteBaseProduct: (productId: string) => Promise<void>;
  deleteMultipleBaseProducts: (productIds: string[]) => Promise<void>;
}

export const BaseProductsContext = createContext<BaseProductsContextType | undefined>(undefined);

export function BaseProductsProvider({ children }: { children: React.ReactNode }) {
  const { user, firebaseUser, loading: authLoading } = useAuth();
  const [baseProducts, setBaseProducts] = useState<BaseProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      setBaseProducts([]);
      setLoading(false);
      return;
    }

    let active = true;
    const applyBaseProducts = (productsData: BaseProduct[]) => {
      if (!active) return;
      setBaseProducts(productsData
        .map((product) => ({ ...product, unit: normalizeMeasurementUnit(product.unit) }))
        .sort((a,b) => (a.name || '').localeCompare(b.name || '')));
      setLoading(false);
    };

    const loadFallback = async () => {
      if (!firebaseUser) {
        if (active) setLoading(false);
        return;
      }

      try {
        const payload = await fetchClientBootstrap(firebaseUser, ["baseProducts"]);
        applyBaseProducts(payload.baseProducts ?? []);
      } catch (fallbackError) {
        console.error("[BaseProductsProvider] API fallback failed:", fallbackError);
        if (active) setLoading(false);
      }
    };

    setLoading(true);
    const q = query(collection(db, "baseProducts"));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const productsData = querySnapshot.docs.map(doc => {
             return { 
                id: doc.id, 
                ...doc.data(),
             } as BaseProduct
        });
        applyBaseProducts(productsData);
    }, (error) => {
        console.error("Error fetching base products from Firestore: ", error);
        void loadFallback();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authLoading, firebaseUser, user]);

  const addBaseProduct = useCallback(async (product: Omit<BaseProduct, 'id'>) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch('/api/registry/base-products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(product),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao adicionar produto base.');
    }
  }, [firebaseUser]);

  const updateBaseProduct = useCallback(async (product: BaseProduct) => {
    const { id, ...dataToUpdate } = product;
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/registry/base-products/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(dataToUpdate),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao atualizar produto base.');
    }
  }, [firebaseUser]);
  
  const updateMultipleBaseProducts = useCallback(async (productsToUpdate: BaseProduct[]) => {
    await Promise.all(productsToUpdate.map((product) => updateBaseProduct(product)));
  }, [updateBaseProduct]);

  const deleteBaseProduct = useCallback(async (productId: string) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/registry/base-products/${productId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha ao excluir produto base.');
    }
  }, [firebaseUser]);

  const deleteMultipleBaseProducts = useCallback(async (productIds: string[]) => {
    await Promise.all(productIds.map((id) => deleteBaseProduct(id)));
  }, [deleteBaseProduct]);
  
  const value: BaseProductsContextType = useMemo(() => ({
    baseProducts,
    loading,
    addBaseProduct,
    updateBaseProduct,
    updateMultipleBaseProducts,
    deleteBaseProduct,
    deleteMultipleBaseProducts,
  }), [baseProducts, loading, addBaseProduct, updateBaseProduct, updateMultipleBaseProducts, deleteBaseProduct, deleteMultipleBaseProducts]);

  return <BaseProductsContext.Provider value={value}>{children}</BaseProductsContext.Provider>;
}
