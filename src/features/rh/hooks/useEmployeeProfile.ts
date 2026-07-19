'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { rhDb } from '@/lib/firebase-rh';
import type {
  Employee,
  EmployeeFieldValue,
  FieldMap,
  RhAccessCache,
  RhRole,
  ImageVoiceConsentRecord,
  OnboardingPrivacyAcknowledgementRecord,
} from '@/types/rh';
import { canViewField } from '@/types/rh';

export type EmployeeProfileData = {
  employee:    Employee;
  fieldValues: Record<string, EmployeeFieldValue>;
  fieldMap:    FieldMap;
  cache:       RhAccessCache;
  consentimento_imagem_voz: ImageVoiceConsentRecord | null;
  ciencia_privacidade_onboarding: OnboardingPrivacyAcknowledgementRecord | null;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: EmployeeProfileData };

function cleanIds(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

export function useEmployeeProfile(bizneoEmployeeId: string, reloadKey = 0): State {
  const { firebaseUser, user } = useAuth();
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!user || !bizneoEmployeeId) return;
    let cancelled = false;

    async function load() {
      setState({ status: 'loading' });
      try {
        if (firebaseUser) {
          const token = await firebaseUser.getIdToken();
          const response = await fetch(`/api/rh/employee-profile/${encodeURIComponent(bizneoEmployeeId)}`, {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          });
          const payload = await response.json().catch(() => ({}));
          if (response.ok) {
            if (!cancelled) {
              setState({ status: 'ok', data: payload as EmployeeProfileData });
            }
            return;
          }
        }

        // Dois doc.get() paralelos — sem query (O(1))
        const [cacheSnap, fieldMapSnap] = await Promise.all([
          getDoc(doc(rhDb, 'rh_access_cache', user!.id)),
          getDoc(doc(rhDb, 'schema', 'field_map')),
        ]);

        if (!cacheSnap.exists()) {
          setState({ status: 'error', message: 'Sem acesso ao módulo RH.' });
          return;
        }
        if (!fieldMapSnap.exists()) {
          setState({ status: 'error', message: 'field_map não encontrado.' });
          return;
        }

        const cache    = cacheSnap.data() as RhAccessCache;
        const fieldMap = fieldMapSnap.data() as FieldMap;

        // Perfil do colaborador
        const empSnap = await getDoc(doc(rhDb, 'employees', bizneoEmployeeId));
        if (!empSnap.exists()) {
          setState({ status: 'error', message: 'Colaborador não encontrado.' });
          return;
        }
        const employee = empSnap.data() as Employee;

        // Ler apenas os documentos que as rules permitem para este papel.
        const fieldValues: Record<string, EmployeeFieldValue> = {};
        const role = cache.rh_role as RhRole;
        const visibilityContext = {
          isOwner: cache.bizneo_employee_id === bizneoEmployeeId || employee.auth_uid === user!.id,
          canViewConfidential: role === 'admin',
          userId: user!.id,
          roleIds: cleanIds([
            cache.job_role_id,
            ...(cache.job_role_ids ?? []),
            ...(cache.role_ids ?? []),
          ]),
          functionIds: cleanIds([
            cache.job_function_id,
            ...(cache.job_function_ids ?? []),
            ...(cache.function_ids ?? []),
          ]),
        };
        const readableKeys = Object.entries(fieldMap.fields)
          .filter(([, entry]) => canViewField(entry.visibility, role, visibilityContext, entry.access, fieldMap.access_matrix))
          .map(([key]) => key);

        const fvSnaps = await Promise.all(
          readableKeys.map((key) =>
            getDoc(doc(rhDb, 'employees', bizneoEmployeeId, 'field_values', key))
          )
        );
        fvSnaps.forEach((snap) => {
          if (snap.exists()) fieldValues[snap.id] = snap.data() as EmployeeFieldValue;
        });

        if (!cancelled) {
          setState({
            status: 'ok',
            data: {
              employee,
              fieldValues,
              fieldMap,
              cache,
              consentimento_imagem_voz: employee.consentimento_imagem_voz ?? null,
              ciencia_privacidade_onboarding: employee.ciencia_privacidade_onboarding ?? null,
            },
          });
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Erro ao carregar perfil.';
          setState({ status: 'error', message: msg });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [firebaseUser, user, bizneoEmployeeId, reloadKey]);

  return state;
}

// ─── useRhCache ───────────────────────────────────────────────────────────────

export function useRhCache(): { cache: RhAccessCache | null; loading: boolean } {
  const { user } = useAuth();
  const [cache, setCache]     = useState<RhAccessCache | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;

    getDoc(doc(rhDb, 'rh_access_cache', user.id)).then((snap) => {
      if (!cancelled) {
        setCache(snap.exists() ? (snap.data() as RhAccessCache) : null);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [user]);

  return { cache, loading };
}

// ─── useFieldMap ──────────────────────────────────────────────────────────────

export function useFieldMap(reloadKey = 0): { fieldMap: FieldMap | null; loading: boolean } {
  const [fieldMap, setFieldMap] = useState<FieldMap | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDoc(doc(rhDb, 'schema', 'field_map')).then((snap) => {
      if (!cancelled) {
        setFieldMap(snap.exists() ? (snap.data() as FieldMap) : null);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  return { fieldMap, loading };
}
