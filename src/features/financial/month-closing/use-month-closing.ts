"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";

import { defaultClosingMonth, isClosableRange } from "./month";
import type { MonthClosingPayload } from "./types";

/** Competência da URL (`?month=AAAA-MM`); valor inválido ou fora do intervalo cai no mês anterior ao atual. */
export function useClosingMonth() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = searchParams.get("month");
  const month = requested && isClosableRange(requested) ? requested : defaultClosingMonth();
  const setMonth = useCallback((next: string) => {
    router.replace(`${pathname}?month=${next}`);
  }, [pathname, router]);
  return { month, setMonth };
}

export function useMonthClosingAccess() {
  const { permissions, isDefaultAdmin } = useAuth();
  return isDefaultAdmin || (permissions.financial?.view === true && permissions.financial?.monthClosings?.view === true);
}

type LoadResult = { key: string; payload: MonthClosingPayload | null; error: string };

/**
 * Uma leitura por competência aberta; sem polling nem listeners. Atualiza só quando a competência muda
 * ou quando a pessoa pede (`reload`), por exemplo ao voltar de Despesas depois de tratar uma pendência.
 * O resultado guarda a chave da leitura: dados de outra competência nunca aparecem como se fossem desta.
 */
export function useMonthClosing(month: string, enabled: boolean) {
  const api = useAuthenticatedApi();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const key = `${month}:${version}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<MonthClosingPayload>(`/api/financial/month-closing?${new URLSearchParams({ month })}`, {
      fallbackError: "Não foi possível carregar o fechamento do mês.",
    }).then((payload) => {
      if (!cancelled) setResult({ key, payload, error: "" });
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setResult({
        key,
        payload: null,
        error: cause instanceof AuthenticatedApiError ? cause.message : "Não foi possível carregar o fechamento do mês.",
      });
    });
    return () => { cancelled = true; };
  }, [api, enabled, key, month]);

  const current = result?.key === key ? result : null;
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { payload: current?.payload ?? null, loading: enabled && current === null, error: current?.error ?? "", reload };
}
