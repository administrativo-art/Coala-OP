"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { SalesChannel, SalesChannelDefaultPriceRule, SalesChannelType } from '@/types';
import { useAuth } from '@/hooks/use-auth';

type ChannelInput = {
  name: string;
  type: SalesChannelType;
  active?: boolean;
  defaultPriceRule?: SalesChannelDefaultPriceRule;
};

type ChannelUpdateInput = Partial<ChannelInput> & {
  updatedAt?: string;
};

type ChannelImpactSummary = {
  affectedProducts: number;
  affectedUnits: number;
};

export interface ChannelsContextType {
  channels: SalesChannel[];
  loading: boolean;
  addChannel: (data: ChannelInput) => Promise<void>;
  updateChannel: (channelId: string, updates: ChannelUpdateInput) => Promise<ChannelImpactSummary>;
  estimateChannelRuleImpact: (channelId: string) => Promise<ChannelImpactSummary>;
}

export const ChannelsContext = createContext<ChannelsContextType | undefined>(undefined);

const DEFAULT_CHANNELS: Array<{ id: string; name: string; type: SalesChannelType }> = [
  { id: 'balcao', name: 'Balcao', type: 'balcao' },
  { id: 'delivery_proprio', name: 'Delivery Proprio', type: 'delivery_proprio' },
  { id: 'ifood', name: 'iFood', type: 'ifood' },
  { id: 'rappi', name: 'Rappi', type: 'rappi' },
];

function normalizeDefaultRule(rule?: SalesChannelDefaultPriceRule) {
  if (!rule || rule.mode === 'none') {
    return null;
  }

  return {
    mode: 'markup' as const,
    value: rule.value,
  };
}

export function ChannelsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const channelQuery = query(collection(db, 'channels'));
    const unsubscribe = onSnapshot(
      channelQuery,
      async (snapshot) => {
        if (snapshot.empty && typeof window !== 'undefined' && !localStorage.getItem('channels_seeded')) {
          const now = new Date().toISOString();
          await Promise.all(
            DEFAULT_CHANNELS.map((channel) =>
              setDoc(doc(db, 'channels', channel.id), {
                ...channel,
                active: true,
                defaultPriceRule: null,
                createdAt: now,
                updatedAt: now,
              })
            )
          );
          localStorage.setItem('channels_seeded', 'true');
          return;
        }

        const data = snapshot.docs
          .map((entry) => ({ id: entry.id, ...entry.data() } as SalesChannel))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        setChannels(data);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching channels:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const estimateChannelRuleImpact = useCallback(async (channelId: string) => {
    const [simulationsSnapshot, overridesSnapshot] = await Promise.all([
      getDocs(collection(db, 'productSimulations')),
      getDocs(query(collection(db, 'priceOverrides'), where('channelId', '==', channelId))),
    ]);

    const overrideSimulationIds = new Set(
      overridesSnapshot.docs
        .map((entry) => entry.data())
        .filter((entry) => entry.unitId === null)
        .map((entry) => String(entry.simulationId))
    );

    let affectedProducts = 0;
    let affectedUnits = 0;

    simulationsSnapshot.docs.forEach((entry) => {
      const data = entry.data() as { kioskIds?: string[] };
      if (overrideSimulationIds.has(entry.id)) {
        return;
      }

      affectedProducts += 1;
      affectedUnits += (data.kioskIds ?? []).length;
    });

    return { affectedProducts, affectedUnits };
  }, []);

  const addChannel = useCallback(async (data: ChannelInput) => {
    if (!user) {
      throw new Error('Usuário não autenticado.');
    }

    const now = new Date().toISOString();
    await addDoc(collection(db, 'channels'), {
      ...data,
      active: data.active ?? true,
      defaultPriceRule: normalizeDefaultRule(data.defaultPriceRule),
      createdAt: now,
      updatedAt: now,
      createdBy: { userId: user.id, username: user.username },
      updatedBy: { userId: user.id, username: user.username },
    });
  }, [user]);

  const updateChannel = useCallback(
    async (channelId: string, updates: ChannelUpdateInput) => {
      if (!user) {
        throw new Error('Usuário não autenticado.');
      }

      const channelRef = doc(db, 'channels', channelId);
      const impactSummary =
        updates.defaultPriceRule !== undefined ? await estimateChannelRuleImpact(channelId) : { affectedProducts: 0, affectedUnits: 0 };

      await runTransaction(db, async (transaction) => {
        const currentSnap = await transaction.get(channelRef);
        if (!currentSnap.exists()) {
          throw new Error('Canal não encontrado.');
        }

        const current = currentSnap.data() as SalesChannel;
        if (updates.updatedAt && current.updatedAt !== updates.updatedAt) {
          const conflictError = new Error('Conflito de edição. Atualize os canais e tente novamente.');
          (conflictError as Error & { status?: number }).status = 409;
          throw conflictError;
        }

        const payload: Record<string, unknown> = {
          updatedAt: new Date().toISOString(),
          updatedBy: { userId: user.id, username: user.username },
        };

        if (updates.name !== undefined) {
          payload.name = updates.name;
        }
        if (updates.type !== undefined) {
          payload.type = updates.type;
        }
        if (updates.active !== undefined) {
          payload.active = updates.active;
        }
        if (updates.defaultPriceRule !== undefined) {
          payload.defaultPriceRule = normalizeDefaultRule(updates.defaultPriceRule);
        }

        transaction.update(channelRef, payload);
      });

      return impactSummary;
    },
    [estimateChannelRuleImpact, user]
  );

  const value = useMemo(
    () => ({
      channels,
      loading,
      addChannel,
      updateChannel,
      estimateChannelRuleImpact,
    }),
    [channels, loading, addChannel, updateChannel, estimateChannelRuleImpact]
  );

  return <ChannelsContext.Provider value={value}>{children}</ChannelsContext.Provider>;
}
