"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';

import { WORKSPACE_ID } from '@/lib/workspace';
import { useAuth } from '@/hooks/use-auth';
import { type OperationalItemCategory, type OperationalItemDestination } from '@/types';

const DEFAULT_OPERATIONAL_ITEM_CATEGORIES: OperationalItemCategory[] = [
  {
    id: 'insumo',
    name: 'Insumo',
    slug: 'insumo',
    destination: 'stock',
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'material-limpeza',
    name: 'Material de limpeza',
    slug: 'material-limpeza',
    destination: 'stock',
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'vestimenta',
    name: 'Vestimenta',
    slug: 'vestimenta',
    destination: 'uniform',
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'patrimonio',
    name: 'Patrimônio',
    slug: 'patrimonio',
    destination: 'asset',
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const DEFAULT_OPERATIONAL_ITEM_CATEGORY_BY_ID = new Map(DEFAULT_OPERATIONAL_ITEM_CATEGORIES.map((category) => [category.id, category]));

export interface OperationalItemCategoriesContextType {
  categories: OperationalItemCategory[];
  activeCategories: OperationalItemCategory[];
  loading: boolean;
  addCategory: (input: { name: string; destination: OperationalItemDestination }) => Promise<void>;
  updateCategory: (id: string, input: { name?: string; destination?: OperationalItemDestination; isArchived?: boolean }) => Promise<void>;
}

export const OperationalItemCategoriesContext = createContext<OperationalItemCategoriesContextType | undefined>(undefined);

function normalizeSlug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '-');
}

function mergeWithDefaultCategories(persisted: OperationalItemCategory[]) {
  const sameWorkspace = persisted.filter((category) => !category.workspaceId || category.workspaceId === WORKSPACE_ID);
  const byId = new Map(sameWorkspace.map((category) => [category.id, category]));
  const bySlug = new Map(sameWorkspace.map((category) => [category.slug, category]));
  const defaultSlugs = new Set(DEFAULT_OPERATIONAL_ITEM_CATEGORIES.map((category) => category.slug));
  const defaultIds = new Set(DEFAULT_OPERATIONAL_ITEM_CATEGORIES.map((category) => category.id));
  const mergedDefaults = DEFAULT_OPERATIONAL_ITEM_CATEGORIES.map((category) => byId.get(category.id) ?? bySlug.get(category.slug) ?? category);
  const customBySlug = new Map<string, OperationalItemCategory>();
  sameWorkspace
    .filter((category) => !defaultIds.has(category.id) && !defaultSlugs.has(category.slug))
    .forEach((category) => {
      const existing = customBySlug.get(category.slug);
      if (!existing || (category.createdAt || '') > (existing.createdAt || '')) {
        customBySlug.set(category.slug, category);
      }
    });
  const customCategories = Array.from(customBySlug.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return [...mergedDefaults, ...customCategories];
}

export function OperationalItemCategoriesProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser } = useAuth();
  const [categories, setCategories] = useState<OperationalItemCategory[]>(DEFAULT_OPERATIONAL_ITEM_CATEGORIES);
  const [loading, setLoading] = useState(true);

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
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Falha na operação de categoria operacional.');
    }
    return response;
  }, [firebaseUser]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      if (!firebaseUser) {
        setCategories(DEFAULT_OPERATIONAL_ITEM_CATEGORIES);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const response = await authedFetch('/api/registry/operational-categories');
        const persisted = await response.json() as OperationalItemCategory[];
        if (!cancelled) setCategories(mergeWithDefaultCategories(persisted));
      } catch (error) {
        console.error('Error fetching operational item categories:', error);
        if (!cancelled) setCategories(DEFAULT_OPERATIONAL_ITEM_CATEGORIES);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCategories();
    return () => {
      cancelled = true;
    };
  }, [authedFetch, firebaseUser]);

  const addCategory = useCallback(async (input: { name: string; destination: OperationalItemDestination }) => {
    const name = input.name.trim();
    const slug = normalizeSlug(name);
    const response = await authedFetch('/api/registry/operational-categories', {
      method: 'POST',
      body: JSON.stringify({ name, slug, destination: input.destination, isArchived: false }),
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.id) {
      const now = new Date().toISOString();
      setCategories((current) => [
        ...current,
        {
          id: payload.id,
          name,
          slug,
          destination: input.destination,
          isArchived: false,
          workspaceId: WORKSPACE_ID,
          createdAt: now,
          createdBy: firebaseUser?.uid,
        },
      ]);
    }
  }, [authedFetch, firebaseUser]);

  const updateCategory = useCallback(async (id: string, input: { name?: string; destination?: OperationalItemDestination; isArchived?: boolean }) => {
    const name = input.name?.trim();
    const defaultCategory = DEFAULT_OPERATIONAL_ITEM_CATEGORY_BY_ID.get(id);
    const previousCategories = categories;
    const optimisticPatch: Partial<OperationalItemCategory> = {
      ...input,
      ...(name ? { name } : {}),
      ...(name ? { slug: defaultCategory?.slug ?? normalizeSlug(name) } : {}),
      updatedAt: new Date().toISOString(),
    };

    setCategories((current) => current.map((category) => (
      category.id === id ? { ...category, ...optimisticPatch } : category
    )));

    try {
      await authedFetch(`/api/registry/operational-categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...input,
          ...(name ? { name } : {}),
          ...(name ? { slug: defaultCategory?.slug ?? normalizeSlug(name) } : {}),
          workspaceId: WORKSPACE_ID,
        }),
      });
    } catch (error) {
      setCategories(previousCategories);
      throw error;
    }
  }, [authedFetch, categories]);

  const activeCategories = useMemo(() => categories.filter((category) => !category.isArchived), [categories]);
  const value = useMemo(
    () => ({ categories, activeCategories, loading, addCategory, updateCategory }),
    [categories, activeCategories, loading, addCategory, updateCategory],
  );

  return (
    <OperationalItemCategoriesContext.Provider value={value}>
      {children}
    </OperationalItemCategoriesContext.Provider>
  );
}
