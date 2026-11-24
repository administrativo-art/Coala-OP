"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";

/** Mês da conferência mais recente: o dia anterior (a Stone publica o arquivo do dia seguinte). */
export const defaultFeeMonth = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 7);

/**
 * Pendências de taxa do vínculo (selo das abas Recebido, A receber e Taxas). `null` = ainda não apuradas
 * ou mês sem conferência. A aba Taxas atualiza o valor por `setPending` quando o operador decide um item.
 */
export function useStoneFeePending({ kioskId, stoneCode, month, enabled = true }: { kioskId?: string; stoneCode: string; month?: string; enabled?: boolean }) {
  const api = useAuthenticatedApi();
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !kioskId || !stoneCode) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) setPending(null); });
    const query = new URLSearchParams({ view: "alert_count", kioskId, stoneCode, month: month ?? defaultFeeMonth() });
    void api<{ pendingCount: number; ready: boolean }>(`/api/financial/stone-fees?${query}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPending(result.ready ? result.pendingCount : null); }).catch(() => {});
    return () => controller.abort();
  }, [api, enabled, kioskId, stoneCode, month]);
  return { pending, setPending };
}
