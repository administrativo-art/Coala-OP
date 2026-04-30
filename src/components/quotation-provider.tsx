"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  type Quotation,
  type QuotationItem,
  type QuotationStatus,
} from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { canViewPurchasing } from '@/lib/purchasing-permissions';

export interface QuotationContextType {
  quotations: Quotation[];
  loading: boolean;
  createQuotation: (data: Pick<Quotation, 'supplierId' | 'mode' | 'validUntil' | 'notes'>) => Promise<string | null>;
  updateQuotation: (id: string, data: Partial<Quotation>) => Promise<void>;
  finalizeQuotation: (id: string, selectedItemIds?: string[]) => Promise<void>;
  archiveQuotation: (id: string) => Promise<void>;
  cancelQuotation: (id: string) => Promise<void>;
  reopenQuotation: (id: string) => Promise<void>;
  addItem: (quotationId: string, data: Omit<QuotationItem, 'id' | 'quotationId' | 'conversionStatus' | 'totalPrice'>) => Promise<string | null>;
  updateItem: (quotationId: string, itemId: string, data: Partial<QuotationItem>) => Promise<void>;
  deleteItem: (quotationId: string, itemId: string) => Promise<void>;
  normalizeItem: (quotationId: string, itemId: string, baseItemId: string) => Promise<void>;
  fetchItems: (quotationId: string) => Promise<QuotationItem[]>;
}

export const QuotationContext = createContext<QuotationContextType | undefined>(undefined);

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export function QuotationProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, permissions } = useAuth();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const canView = canViewPurchasing(permissions);

  const authorizedRequest = useCallback(
    async <T,>(path: string, init: RequestInit, fallbackError: string): Promise<T> => {
      if (!firebaseUser) {
        throw new Error('Usuário não autenticado.');
      }
      const token = await firebaseUser.getIdToken();
      const response = await fetch(path, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || fallbackError);
      }
      return response.json() as Promise<T>;
    },
    [firebaseUser],
  );

  const fetchQuotations = useCallback(async () => {
    if (!canView || !firebaseUser) {
      setQuotations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await authorizedRequest<Quotation[]>(
        '/api/purchasing/quotations',
        { method: 'GET' },
        'Falha ao carregar cotações.',
      );
      setQuotations(
        [...data].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      );
    } catch (err) {
      console.error('Error fetching quotations:', err);
      setQuotations([]);
    } finally {
      setLoading(false);
    }
  }, [authorizedRequest, canView, firebaseUser]);

  useEffect(() => {
    void fetchQuotations();
  }, [fetchQuotations]);

  const createQuotation = useCallback(
    async (data: Pick<Quotation, 'supplierId' | 'mode' | 'validUntil' | 'notes'>): Promise<string | null> => {
      try {
        const payload = await authorizedRequest<{ id: string }>(
          '/api/purchasing/quotations',
          {
            method: 'POST',
            body: JSON.stringify({
              supplierId: data.supplierId,
              mode: data.mode,
              validUntil: data.validUntil ?? null,
              notes: data.notes ?? null,
            }),
          },
          'Falha ao criar cotação.',
        );
        await fetchQuotations();
        return payload.id;
      } catch (e) {
        console.error('Error creating quotation:', e);
        return null;
      }
    },
    [authorizedRequest],
  );

  const updateQuotation = useCallback(async (id: string, data: Partial<Quotation>) => {
    await authorizedRequest<{ ok: true }>(
      `/api/purchasing/quotations/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
      'Falha ao atualizar cotação.',
    );
    await fetchQuotations();
  }, [authorizedRequest, fetchQuotations]);

  const finalizeQuotation = useCallback(async (id: string, selectedItemIds?: string[]) => {
    await authorizedRequest<{ ok: true }>(
      `/api/purchasing/quotations/${id}/finalize`,
      {
        method: 'POST',
        body: JSON.stringify({ selectedItemIds: selectedItemIds ?? [] }),
      },
      'Falha ao finalizar cotação.',
    );
    await fetchQuotations();
  }, [authorizedRequest, fetchQuotations]);

  const cancelQuotation = useCallback(async (id: string) => {
    await authorizedRequest<{ ok: true }>(
      `/api/purchasing/quotations/${id}/cancel`,
      { method: 'POST' },
      'Falha ao cancelar cotação.',
    );
    await fetchQuotations();
  }, [authorizedRequest, fetchQuotations]);

  const archiveQuotation = useCallback(async (id: string) => {
    await authorizedRequest<{ ok: true }>(
      `/api/purchasing/quotations/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'archived' as QuotationStatus,
          archivedAt: new Date().toISOString(),
        }),
      },
      'Falha ao arquivar cotação.',
    );
    await fetchQuotations();
  }, [authorizedRequest, fetchQuotations]);

  const reopenQuotation = useCallback(async (id: string) => {
    await authorizedRequest<{ ok: true }>(
      `/api/purchasing/quotations/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'draft' as QuotationStatus,
          finalizedAt: null,
          archivedAt: null,
        }),
      },
      'Falha ao reabrir cotação.',
    );
    await fetchQuotations();
  }, [authorizedRequest, fetchQuotations]);

  const addItem = useCallback(
    async (
      quotationId: string,
      data: Omit<QuotationItem, 'id' | 'quotationId' | 'conversionStatus' | 'totalPrice'>,
    ): Promise<string | null> => {
      const newItem = stripUndefined({
        ...data,
        quotationId,
        totalPrice: Math.max(data.unitPrice * data.quantity - (data.discount ?? 0), 0),
        conversionStatus: 'pending' as const,
      });
      try {
        const payload = await authorizedRequest<{ id: string }>(
          `/api/purchasing/quotations/${quotationId}/items`,
          {
            method: 'POST',
            body: JSON.stringify(newItem),
          },
          'Falha ao adicionar item à cotação.',
        );
        return payload.id;
      } catch (e) {
        console.error('Error adding quotation item:', e);
        return null;
      }
    },
    [authorizedRequest],
  );

  const updateItem = useCallback(
    async (quotationId: string, itemId: string, data: Partial<QuotationItem>) => {
      await authorizedRequest<{ ok: true }>(
        `/api/purchasing/quotations/${quotationId}/items/${itemId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(data),
        },
        'Falha ao atualizar item da cotação.',
      );
    },
    [authorizedRequest],
  );

  const deleteItem = useCallback(async (quotationId: string, itemId: string) => {
    await authorizedRequest<{ ok: true }>(
      `/api/purchasing/quotations/${quotationId}/items/${itemId}`,
      { method: 'DELETE' },
      'Falha ao remover item da cotação.',
    );
  }, [authorizedRequest]);

  const normalizeItem = useCallback(
    async (quotationId: string, itemId: string, baseItemId: string) => {
      await authorizedRequest<{ ok: true }>(
        `/api/purchasing/quotations/${quotationId}/items/${itemId}/normalize`,
        {
          method: 'POST',
          body: JSON.stringify({
            baseItemId,
          }),
        },
        'Falha ao normalizar item da cotação.',
      );
    },
    [authorizedRequest],
  );

  const fetchItems = useCallback(async (quotationId: string): Promise<QuotationItem[]> => {
    return authorizedRequest<QuotationItem[]>(
      `/api/purchasing/quotations/${quotationId}/items`,
      { method: 'GET' },
      'Falha ao carregar itens da cotação.',
    );
  }, [authorizedRequest]);

  const value: QuotationContextType = useMemo(
    () => ({
      quotations,
      loading,
      createQuotation,
      updateQuotation,
      finalizeQuotation,
      archiveQuotation,
      cancelQuotation,
      reopenQuotation,
      addItem,
      updateItem,
      deleteItem,
      normalizeItem,
      fetchItems,
    }),
    [
      quotations,
      loading,
      createQuotation,
      updateQuotation,
      finalizeQuotation,
      archiveQuotation,
      cancelQuotation,
      reopenQuotation,
      addItem,
      updateItem,
      deleteItem,
      normalizeItem,
      fetchItems,
    ],
  );

  return <QuotationContext.Provider value={value}>{children}</QuotationContext.Provider>;
}
