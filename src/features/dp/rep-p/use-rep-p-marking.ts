"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { useAuth } from "@/hooks/use-auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import { repPDateInZone } from "./time-zones";

export type RepPReceiptStatus = "available" | "pending";
/** `timeZone` nulo: a unidade usa o fuso do estabelecimento. */
export type RepPLocationPolicyForCollector = {
  mode: "disabled" | "observe"; revision: number; captureTimeoutMs: number | null;
  maxAccuracyMeters: number | null; privacyNoticeUrl: string | null;
};
export type RepPLocationAttemptPayload = {
  captureId: string; elapsedMs: number; status: "captured" | "denied" | "unavailable" | "timeout" | "unsupported" | "error";
  capturedAt?: string; latitude?: number; longitude?: number; accuracyMeters?: number;
};
export type RepPExecutionUnit = { id: string; name: string; employer: boolean; timeZone: string | null; locationPolicy: RepPLocationPolicyForCollector };
export type RepPOfficialClock = { available: true; instant: string; timeZone: string } | { available: false; issue: string };
export type RepPOptionsPayload = { workDate: string; eligible: boolean; markingEnabled: boolean; executionUnits: RepPExecutionUnit[]; officialClock: RepPOfficialClock | null };
export type RepPMarkingPayload = {
  status: "recorded" | "replayed"; receiptId: string; receiptStatus: RepPReceiptStatus; receiptIssue: string | null;
  location: { captureStatus: string; evaluation: "inside" | "outside" | "indeterminate" | "not_requested" } | null;
  marking: { nsr: number; markedAt: string; executionUnitId: string };
};
export type RepPLocationCaptureState = "idle" | "capturing" | "ready" | "imprecise" | "unavailable";
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

function locationFailure(captureId: string, startedAt: number, status: RepPLocationAttemptPayload["status"]): RepPLocationAttemptPayload {
  return { captureId, status, elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)) };
}

/** Executada somente pelo clique final de confirmação; nunca no carregamento, troca de unidade ou em segundo plano. */
async function captureLocation(timeoutMs: number): Promise<RepPLocationAttemptPayload> {
  const captureId = newAttemptId();
  const startedAt = performance.now();
  if (typeof navigator === "undefined" || !navigator.geolocation) return locationFailure(captureId, startedAt, "unsupported");
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition((position) => resolve({
    captureId, status: "captured", elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    capturedAt: new Date(position.timestamp).toISOString(), latitude: position.coords.latitude,
    longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy,
  }), (error) => resolve(locationFailure(captureId, startedAt,
    error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable")), {
    enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs,
  }));
}

/**
 * Coleta da batida compartilhada por "Registro de ponto" e pela janela rápida da barra superior:
 * opções do vínculo de hoje, unidade escolhida e a tentativa idempotente.
 */
export function useRepPMarking({ onRecorded, enabled = true }: { onRecorded?: (result: RepPMarkingPayload) => void; enabled?: boolean } = {}) {
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
  const [locationCaptureState, setLocationCaptureState] = useState<RepPLocationCaptureState>("idle");
  const locationAttempt = useRef<{ attemptId: string; unitId: string; value: RepPLocationAttemptPayload } | null>(null);

  const loadOptions = useCallback(async () => {
    if (!firebaseUser || !enabled) return;
    setOptionsError(null);
    try {
      const payload = await request<RepPOptionsPayload>(`/api/dp/time-recording/options?workDate=${today}`,
        { fallbackError: "Não foi possível carregar as unidades." });
      setOptions(payload);
      setUnitIdState((current) => payload.executionUnits.some((unit) => unit.id === current) ? current : payload.executionUnits[0]?.id || "");
    } catch (error) {
      setOptionsError(errorMessageOf(error, "Não foi possível carregar as unidades."));
    }
  }, [enabled, firebaseUser, request, today]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const setUnitId = useCallback((next: string) => {
    setUnitIdState(next);
    setAttemptId(newAttemptId());
    locationAttempt.current = null;
    setLocationCaptureState("idle");
  }, []);
  const discardPendingAttempt = useCallback(() => {
    locationAttempt.current = null;
    setAttemptId(newAttemptId());
    setLocationCaptureState("idle");
    setRecordError(null);
  }, []);

  const record = useCallback(async () => {
    if (!unitId) return;
    const clock = options?.officialClock;
    const unit = options?.executionUnits.find((candidate) => candidate.id === unitId);
    const locationPolicy = unit?.locationPolicy;
    const zone = unit?.timeZone ?? (clock?.available ? clock.timeZone : null);
    setRecording(true);
    setRecordError(null);
    try {
      let captured = locationAttempt.current?.attemptId === attemptId && locationAttempt.current.unitId === unitId
        ? locationAttempt.current.value : null;
      if (locationPolicy && locationPolicy.mode !== "disabled" && !captured) {
        setLocationCaptureState("capturing");
        captured = await captureLocation(locationPolicy.captureTimeoutMs ?? 10_000);
        locationAttempt.current = { attemptId, unitId, value: captured };
        setLocationCaptureState(captured.status === "captured"
          ? ((captured.accuracyMeters ?? Infinity) <= (locationPolicy.maxAccuracyMeters ?? 100) ? "ready" : "imprecise") : "unavailable");
      }
      const result = await request<RepPMarkingPayload>("/api/dp/time-recording/markings", {
        // A data vai no fuso da unidade, o mesmo que o servidor confere; o do aparelho recusaria batidas perto da meia-noite.
        method: "POST", json: { attemptId, workDate: zone ? repPDateInZone(zone) : repPLocalDate(), executionUnitId: unitId,
          channel: "browser", ...(captured ? { locationAttempt: captured } : {}) },
        fallbackError: "Não foi possível registrar o ponto.",
      });
      setLastMarking(result);
      setAttemptId(newAttemptId());
      locationAttempt.current = null;
      onRecorded?.(result);
    } catch (error) {
      setRecordError(errorMessageOf(error, "Não foi possível registrar o ponto."));
    } finally {
      setRecording(false);
    }
  }, [attemptId, onRecorded, options, request, unitId]);

  const fetchReceiptFile = useCallback(async (receiptId: string, nsr: number, markedAt: string) => {
    const blob = await request<Blob>(`/api/dp/time-recording/receipts/${receiptId}`,
      { responseType: "blob", fallbackError: "Não foi possível abrir o comprovante." });
    return new File([blob], `comprovante-ponto-${markedAt.slice(0, 10)}-nsr-${nsr}.pdf`, { type: "application/pdf" });
  }, [request]);

  // O relógio mostra a hora no fuso da unidade escolhida, o mesmo que a batida vai gravar.
  const unitClock = useMemo<RepPOfficialClock | null>(() => {
    const clock = options?.officialClock ?? null;
    const zone = options?.executionUnits.find((unit) => unit.id === unitId)?.timeZone;
    return clock?.available && zone ? { ...clock, timeZone: zone } : clock;
  }, [options, unitId]);
  const unitLocationPolicy = useMemo(() => options?.executionUnits.find((unit) => unit.id === unitId)?.locationPolicy ?? null,
    [options, unitId]);

  return {
    today, request, fetchReceiptFile, options, optionsError, loadOptions, unitId, setUnitId, unitClock,
    recording, recordError, record, lastMarking, setLastMarking, locationCaptureState, unitLocationPolicy, discardPendingAttempt,
    canRecord: Boolean(unitId) && options?.markingEnabled === true && options?.officialClock?.available === true,
  };
}
