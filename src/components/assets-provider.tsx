"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { WORKSPACE_ID } from '@/lib/workspace';
import { useAuth } from '@/hooks/use-auth';
import type { Asset, AssetCategory, AssetMovement, AssetStatus } from '@/types';

type AssetInput = Omit<Asset, 'id' | 'code' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'> & {
  code?: string;
  status?: AssetStatus;
};

export interface AssetsContextType {
  assets: Asset[];
  categories: AssetCategory[];
  loading: boolean;
  addAsset: (asset: AssetInput) => Promise<void>;
  addCategory: (name: string, description?: string) => Promise<void>;
  updateAsset: (assetId: string, patch: Partial<Asset>) => Promise<void>;
  transferAsset: (assetId: string, toKioskId: string, toKioskName?: string, notes?: string) => Promise<void>;
  updateAssetStatus: (assetId: string, status: AssetStatus, notes?: string) => Promise<void>;
  recordLabelPrint: (assetId: string) => Promise<void>;
  fetchMovements: (assetId: string) => Promise<AssetMovement[]>;
}

export const AssetsContext = createContext<AssetsContextType | undefined>(undefined);

export function AssetsProvider({ children }: { children: React.ReactNode }) {
  const { permissions, firebaseUser } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const canView = permissions.assets?.view;

  useEffect(() => {
    if (!canView) {
      setAssets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(db, 'assets'), where('workspaceId', '==', WORKSPACE_ID));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAssets(
          snap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() } as Asset))
            .sort((a, b) => a.code.localeCompare(b.code)),
        );
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching assets:', error);
        setLoading(false);
      },
    );
    return unsub;
  }, [canView]);

  useEffect(() => {
    if (!canView) {
      setCategories([]);
      return;
    }
    const q = query(collection(db, 'assetCategories'), where('workspaceId', '==', WORKSPACE_ID));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCategories(
          snap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() } as AssetCategory))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      },
      (error) => {
        console.error('Error fetching asset categories:', error);
      },
    );
    return unsub;
  }, [canView]);

  const authedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!firebaseUser) throw new Error('Usuário não autenticado.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Falha na operação de patrimônio.');
    }
    return response;
  }, [firebaseUser]);

  const addAsset = useCallback(async (asset: AssetInput) => {
    await authedFetch('/api/assets', { method: 'POST', body: JSON.stringify(asset) });
  }, [authedFetch]);

  const addCategory = useCallback(async (name: string, description?: string) => {
    await authedFetch('/api/assets/categories', { method: 'POST', body: JSON.stringify({ name, description }) });
  }, [authedFetch]);

  const updateAsset = useCallback(async (assetId: string, patch: Partial<Asset>) => {
    await authedFetch(`/api/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  }, [authedFetch]);

  const transferAsset = useCallback(async (assetId: string, toKioskId: string, toKioskName?: string, notes?: string) => {
    await authedFetch(`/api/assets/${assetId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'transfer', toKioskId, toKioskName, notes }),
    });
  }, [authedFetch]);

  const updateAssetStatus = useCallback(async (assetId: string, status: AssetStatus, notes?: string) => {
    await authedFetch(`/api/assets/${assetId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'status', status, notes }),
    });
  }, [authedFetch]);

  const recordLabelPrint = useCallback(async (assetId: string) => {
    await authedFetch(`/api/assets/${assetId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'print-label' }),
    });
  }, [authedFetch]);

  const fetchMovements = useCallback(async (assetId: string) => {
    const response = await authedFetch(`/api/assets/${assetId}/movements`, { method: 'GET' });
    return response.json() as Promise<AssetMovement[]>;
  }, [authedFetch]);

  const value = useMemo(() => ({
    assets,
    categories,
    loading,
    addAsset,
    addCategory,
    updateAsset,
    transferAsset,
    updateAssetStatus,
    recordLabelPrint,
    fetchMovements,
  }), [assets, categories, loading, addAsset, addCategory, updateAsset, transferAsset, updateAssetStatus, recordLabelPrint, fetchMovements]);

  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}
