"use client";

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { getFlattenedAccountPlanOptions, type AccountPlanOption, type ResultCenterOption } from '@/lib/purchasing-financial-options';

export type PaymentCardOption = {
  accountId: string;
  accountName: string;
  methodId: string;
  methodLabel: string;
  type: 'credit_card' | 'debit_card';
  lastDigits?: string;
};

type ResponsePayload = {
  accountPlans: AccountPlanOption[];
  resultCenters: ResultCenterOption[];
  paymentCards: PaymentCardOption[];
};

export function usePurchasingFinancialOptions() {
  const { firebaseUser } = useAuth();
  const [accountPlans, setAccountPlans] = useState<AccountPlanOption[]>([]);
  const [resultCenters, setResultCenters] = useState<ResultCenterOption[]>([]);
  const [paymentCards, setPaymentCards] = useState<PaymentCardOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!firebaseUser) {
        if (!cancelled) {
          setAccountPlans([]);
          setResultCenters([]);
          setPaymentCards([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/purchasing/classification-options', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<ResponsePayload>;
        if (!response.ok || cancelled) return;
        setAccountPlans(payload.accountPlans ?? []);
        setResultCenters(payload.resultCenters ?? []);
        setPaymentCards(payload.paymentCards ?? []);
      } catch (error) {
        console.error('Error loading purchasing financial options:', error);
        if (!cancelled) {
          setAccountPlans([]);
          setResultCenters([]);
          setPaymentCards([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const flattenedAccountPlans = useMemo(
    () => getFlattenedAccountPlanOptions(accountPlans),
    [accountPlans],
  );

  return {
    accountPlans,
    resultCenters,
    paymentCards,
    flattenedAccountPlans,
    loading,
  };
}
