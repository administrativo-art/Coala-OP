"use client";

import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { DEFAULT_GOAL_METHOD_CONFIGS, buildGoalMethodSnapshot } from '@/lib/goal-methods';
import { type GoalMethodConfig, type GoalMethodSnapshot } from '@/types';

function asConfig(snapshot: GoalMethodSnapshot): GoalMethodConfig {
  return {
    ...snapshot,
    tiers: snapshot.tiers.map(tier => ({ ...tier })),
    teamBonus: {
      ...snapshot.teamBonus,
      reliefWorker: snapshot.teamBonus.reliefWorker ? { ...snapshot.teamBonus.reliefWorker } : undefined,
    },
    leadershipBonus: { ...snapshot.leadershipBonus },
    incentiveMessages: snapshot.incentiveMessages.map(rule => ({ ...rule })),
  };
}

function mergeWithDefaults(remote: GoalMethodConfig[]): GoalMethodConfig[] {
  const byId = new Map<string, GoalMethodConfig>();
  DEFAULT_GOAL_METHOD_CONFIGS.forEach(config => {
    byId.set(config.id, asConfig(config));
  });
  remote.forEach(config => {
    const base = byId.get(config.id);
    byId.set(config.id, {
      ...base,
      ...config,
      tiers: (config.tiers ?? base?.tiers ?? []).map(tier => ({ ...tier })),
      teamBonus: {
        ...base?.teamBonus,
        ...config.teamBonus,
        reliefWorker: config.teamBonus?.reliefWorker
          ? { ...config.teamBonus.reliefWorker }
          : base?.teamBonus.reliefWorker ? { ...base.teamBonus.reliefWorker } : undefined,
      },
      leadershipBonus: { ...base?.leadershipBonus, ...config.leadershipBonus },
      incentiveMessages: (config.incentiveMessages ?? base?.incentiveMessages ?? []).map(rule => ({ ...rule })),
    });
  });
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function useGoalMethodConfigs() {
  const [remoteConfigs, setRemoteConfigs] = useState<GoalMethodConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'goalMethodConfigs', 'registry'),
      snapshot => {
        const data = snapshot.data();
        const configs = Array.isArray(data?.configs) ? data.configs : [];
        setRemoteConfigs(configs as GoalMethodConfig[]);
        setError(null);
        setLoading(false);
      },
      err => {
        console.warn('[useGoalMethodConfigs] Firestore fallback:', err.code, err.message);
        setRemoteConfigs([]);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const configs = useMemo(() => mergeWithDefaults(remoteConfigs), [remoteConfigs]);
  const activeConfigs = useMemo(() => configs.filter(config => config.active), [configs]);

  async function upsertGoalMethodConfig(config: GoalMethodConfig | GoalMethodSnapshot) {
    const snapshot = buildGoalMethodSnapshot(config);
    const nextConfigs = mergeWithDefaults(remoteConfigs).map(item =>
      item.id === snapshot.id ? asConfig(snapshot) : item
    );

    if (!nextConfigs.some(item => item.id === snapshot.id)) {
      nextConfigs.push(asConfig(snapshot));
    }

    await setDoc(
      doc(db, 'goalMethodConfigs', 'registry'),
      {
        configs: nextConfigs.map(item => buildGoalMethodSnapshot(item)),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    configs,
    activeConfigs,
    loading,
    error,
    upsertGoalMethodConfig,
  };
}
