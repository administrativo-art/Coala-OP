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

function sortAssets(items: Asset[]) {
  return [...items].sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')));
}

function sortCategories(items: AssetCategory[]) {
  return [...items].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

export function AssetsProvider({ children }: { children: React.ReactNode }) {
  const { permissions, firebaseUser } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const canView = permissions.assets?.view;

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

  const refreshAssets = useCallback(async () => {
    const response = await authedFetch('/api/assets', { method: 'GET' });
    const data = await response.json();
    setAssets(sortAssets(data));
  }, [authedFetch]);

  const refreshCategories = useCallback(async () => {
    const response = await authedFetch('/api/assets/categories', { method: 'GET' });
    const data = await response.json();
    setCategories(sortCategories(data));
  }, [authedFetch]);

  useEffect(() => {
    if (!canView) {
      setAssets([]);
      setLoading(false);
      return;
    }
    if (!firebaseUser) {
      setLoading(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    refreshAssets()
      .catch((error) => {
        console.error('Error fetching assets from API:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const q = query(collection(db, 'assets'), where('workspaceId', '==', WORKSPACE_ID));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const nextAssets = sortAssets(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Asset)));
        setAssets((current) => (nextAssets.length === 0 && current.length > 0 ? current : nextAssets));
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching assets:', error);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [canView, firebaseUser, refreshAssets]);

  useEffect(() => {
    if (!canView) {
      setCategories([]);
      return;
    }
    if (!firebaseUser) return;

    let cancelled = false;
    refreshCategories().catch((error) => {
      console.error('Error fetching asset categories from API:', error);
    });

    const q = query(collection(db, 'assetCategories'), where('workspaceId', '==', WORKSPACE_ID));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        const nextCategories = sortCategories(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as AssetCategory)));
        setCategories((current) => (nextCategories.length === 0 && current.length > 0 ? current : nextCategories));
      },
      (error) => {
        console.error('Error fetching asset categories:', error);
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [canView, firebaseUser, refreshCategories]);

  const addAsset = useCallback(async (asset: AssetInput) => {
    await authedFetch('/api/assets', { method: 'POST', body: JSON.stringify(asset) });
    await refreshAssets();
  }, [authedFetch, refreshAssets]);

  const addCategory = useCallback(async (name: string, description?: string) => {
    await authedFetch('/api/assets/categories', { method: 'POST', body: JSON.stringify({ name, description }) });
    await refreshCategories();
  }, [authedFetch, refreshCategories]);

  const updateAsset = useCallback(async (assetId: string, patch: Partial<Asset>) => {
    await authedFetch(`/api/assets/${assetId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await refreshAssets();
  }, [authedFetch, refreshAssets]);

  const transferAsset = useCallback(async (assetId: string, toKioskId: string, toKioskName?: string, notes?: string) => {
    await authedFetch(`/api/assets/${assetId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'transfer', toKioskId, toKioskName, notes }),
    });
    await refreshAssets();
  }, [authedFetch, refreshAssets]);

  const updateAssetStatus = useCallback(async (assetId: string, status: AssetStatus, notes?: string) => {
    await authedFetch(`/api/assets/${assetId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'status', status, notes }),
    });
    await refreshAssets();
  }, [authedFetch, refreshAssets]);

  const recordLabelPrint = useCallback(async (assetId: string) => {
    await authedFetch(`/api/assets/${assetId}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'print-label' }),
    });
    await refreshAssets();
  }, [authedFetch, refreshAssets]);

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
