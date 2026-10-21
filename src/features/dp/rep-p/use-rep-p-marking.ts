"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { useAuth } from "@/hooks/use-auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

export type RepPReceiptStatus = "available" | "pending";
export type RepPExecutionUnit = { id: string; name: string; employer: boolean };
export type RepPOfficialClock = { available: true; instant: string; timeZone: string } | { available: false; issue: string };
export type RepPOptionsPayload = { workDate: string; eligible: boolean; markingEnabled: boolean; executionUnits: RepPExecutionUnit[]; officialClock: RepPOfficialClock | null };
export type RepPMarkingPayload = {
  status: "recorded" | "replayed"; receiptId: string; receiptStatus: RepPReceiptStatus; receiptIssue: string | null;
  marking: { nsr: number; markedAt: string; executionUnitId: string };
};
type RequestOptions = Omit<Parameters<typeof authenticatedApiRequest>[1], "getIdToken">;

/** Data civil local do aparelho; o servidor recusa se divergir da hora oficial do estabelecimento. */
export function repPLocalDate(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function newAttemptId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Coleta da batida compartilhada por "Registro de ponto" e pela janela rápida da barra superior:
 * opções do vínculo de hoje, unidade escolhida e a tentativa idempotente.
 */
export function useRepPMarking({ onRecorded }: { onRecorded?: (result: RepPMarkingPayload) => void } = {}) {
  const { firebaseUser } = useAuth();
  const today = useMemo(() => repPLocalDate(), []);
  const request = useCallback(<T,>(input: string, init: RequestOptions) => authenticatedApiRequest<T>(input, {
    ...init, getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null),
  }), [firebaseUser]);

  const [options, setOptions] = useState<RepPOptionsPayload | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [unitId, setUnitIdState] = useState("");
  // A mesma tentativa é reenviada até haver resposta; o servidor devolve a batida já gravada sem duplicar.
  const [attemptId, setAttemptId] = useState(newAttemptId);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [lastMarking, setLastMarking] = useState<RepPMarkingPayload | null>(null);

  const loadOptions = useCallback(async () => {
    if (!firebaseUser) return;
    setOptionsError(null);
    try {
      const payload = await request<RepPOptionsPayload>(`/api/dp/time-recording/options?workDate=${today}`,
        { fallbackError: "Não foi possível carregar as unidades." });
      setOptions(payload);
      setUnitIdState((current) => payload.executionUnits.some((unit) => unit.id === current) ? current : payload.executionUnits[0]?.id || "");
    } catch (error) {
      setOptionsError(errorMessageOf(error, "Não foi possível carregar as unidades."));
    }
  }, [firebaseUser, request, today]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const setUnitId = useCallback((next: string) => {
    setUnitIdState(next);
    setAttemptId(newAttemptId());
  }, []);

  const record = useCallback(async () => {
    if (!unitId) return;
    setRecording(true);
    setRecordError(null);
    try {
      const result = await request<RepPMarkingPayload>("/api/dp/time-recording/markings", {
        method: "POST", json: { attemptId, workDate: repPLocalDate(), executionUnitId: unitId, channel: "browser" },
        fallbackError: "Não foi possível registrar o ponto.",
      });
      setLastMarking(result);
      setAttemptId(newAttemptId());
      onRecorded?.(result);
    } catch (error) {
      setRecordError(errorMessageOf(error, "Não foi possível registrar o ponto."));
    } finally {
      setRecording(false);
    }
  }, [attemptId, onRecorded, request, unitId]);

  const fetchReceiptFile = useCallback(async (receiptId: string, nsr: number, markedAt: string) => {
    const blob = await request<Blob>(`/api/dp/time-recording/receipts/${receiptId}`,
      { responseType: "blob", fallbackError: "Não foi possível abrir o comprovante." });
    return new File([blob], `comprovante-ponto-${markedAt.slice(0, 10)}-nsr-${nsr}.pdf`, { type: "application/pdf" });
  }, [request]);

  return {
    today, request, fetchReceiptFile, options, optionsError, loadOptions, unitId, setUnitId,
    recording, recordError, record, lastMarking, setLastMarking,
    canRecord: Boolean(unitId) && options?.markingEnabled === true && options?.officialClock?.available === true,
  };
}
