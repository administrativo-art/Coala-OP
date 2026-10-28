"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { useAuth } from "@/hooks/use-auth";
import { AuthenticatedApiError, authenticatedApiRequest } from "@/lib/authenticated-api-client";

import { officialClockOffsetMs } from "./official-clock";
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
export type RepPOptionsPayload = { workDate: string; eligible: boolean; markingEnabled: boolean;
  mode: "official" | "pilot" | "disabled"; executionUnits: RepPExecutionUnit[]; officialClock: RepPOfficialClock | null };
export type RepPMarkingPayload = {
  status: "recorded" | "replayed"; pilot: boolean; receiptId: string; receiptStatus: RepPReceiptStatus; receiptIssue: string | null;
  location: { captureStatus: string; evaluation: "inside" | "outside" | "indeterminate" | "not_requested" } | null;
  marking: { nsr: number; markedAt: string; executionUnitId: string };
};
export type RepPLocationCaptureState = "idle" | "capturing" | "ready" | "imprecise" | "unavailable";
type RequestOptions = Omit<Parameters<typeof authenticatedApiRequest>[1], "getIdToken">;
export type RepPMarkingPurpose = "journey_start" | "break_start" | "break_end" | "journey_end";
/**
 * Tentativa enviada sem resposta conclusiva. Identificador, data, unidade, finalidade e localização viajam juntos e
 * sobrevivem à recarga da página: reenviar é a mesma tentativa, e o servidor devolve a batida já gravada sem duplicar.
 * `firstTriedAt` é só informativo (hora oficial vista na tela); a hora gravada é sempre a do servidor.
 */
export type RepPPendingAttempt = {
  attemptId: string; workDate: string; unitId: string; purpose: RepPMarkingPurpose; firstTriedAt: string | null;
  /** A localização precisa ir igual no reenvio (o servidor compara o pedido inteiro); por isso fica guardada, só até expirar. */
  location: RepPLocationAttemptPayload | null;
  /** Relógio do aparelho ao guardar, só para expirar a tentativa. */
  savedAt: number;
};
/** Depois disso a tentativa deixa de ser oferecida: o reenvio de outro dia não serve mais para recuperar a batida. */
export const PENDING_ATTEMPT_TTL_MS = 36 * 60 * 60 * 1000;

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

const PENDING_PREFIX = "coala.repP.pendingAttempt.";
const PENDING_KEY = (uid: string) => `${PENDING_PREFIX}${uid}`;
export function parsePendingAttempt(raw: string | null, now = Date.now()): RepPPendingAttempt | null {
  try {
    const value = JSON.parse(raw ?? "null") as RepPPendingAttempt | null;
    if (!value || typeof value.attemptId !== "string" || typeof value.workDate !== "string" || typeof value.unitId !== "string"
      || typeof value.purpose !== "string" || typeof value.savedAt !== "number") return null;
    return now - value.savedAt > PENDING_ATTEMPT_TTL_MS ? null : value;
  } catch { return null; }
}
function readPending(uid: string | undefined): RepPPendingAttempt | null {
  if (!uid) return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY(uid));
    const value = parsePendingAttempt(raw);
    if (raw && !value) window.localStorage.removeItem(PENDING_KEY(uid));
    return value;
  } catch { return null; }
}
function writePending(uid: string | undefined, value: RepPPendingAttempt | null) {
  if (!uid) return;
  try {
    if (value) window.localStorage.setItem(PENDING_KEY(uid), JSON.stringify(value));
    else window.localStorage.removeItem(PENDING_KEY(uid));
  } catch { /* Sem armazenamento local a tentativa continua na memória da aba. */ }
}

/**
 * Códigos que o servidor só devolve depois de conferir a tentativa e não encontrá-la gravada
 * (`service.server.ts`, após a leitura de ATTEMPTS): provam que nada foi registrado com aquele identificador.
 */
const NOT_RECORDED_CODES = new Set(["REP_P_WORK_DATE_MISMATCH", "REP_P_EMPLOYMENT_UNRESOLVED", "REP_P_EMPLOYMENT_NOT_ELIGIBLE",
  "REP_P_EXECUTION_UNIT_OUTSIDE_EMPLOYMENT", "REP_P_EXECUTION_UNIT_MISSING", "REP_P_ESTABLISHMENT_NOT_READY", "REP_P_TIME_UNAVAILABLE"]);
function errorCodeOf(error: AuthenticatedApiError) {
  const payload = error.payload as { error?: { code?: unknown } } | null;
  return typeof payload?.error?.code === "string" ? payload.error.code : null;
}
/** Falha sem resposta conclusiva: rede, 408, 429 e 5xx. A batida pode ter sido gravada. */
export function isAmbiguousMarkingFailure(error: unknown) {
  if (!(error instanceof AuthenticatedApiError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}
/**
 * O que fazer com a tentativa depois de uma falha, igual ao Coala Go:
 * - primeira tentativa: resposta explícita do servidor (4xx) prova que nada foi gravado; falha ambígua guarda a tentativa;
 * - reenvio: só 409 (conflito com o que já está gravado) ou um código que prova "não gravada" encerram; o resto
 *   (inclusive 401/403, verificados antes da tentativa) mantém a mesma tentativa para não abrir uma batida em duplicidade.
 */
export function markingFailureOutcome(error: unknown, replaying: boolean): "keep" | "conflict" | "not_recorded" {
  if (isAmbiguousMarkingFailure(error)) return "keep";
  const failure = error as AuthenticatedApiError;
  if (failure.status === 409) return "conflict";
  const code = errorCodeOf(failure);
  if (code && NOT_RECORDED_CODES.has(code)) return "not_recorded";
  return replaying ? "keep" : "not_recorded";
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
  const [pendingAttempt, setPendingAttemptState] = useState<RepPPendingAttempt | null>(null);
  const uid = firebaseUser?.uid;
  const previousUid = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Ao sair da conta, a tentativa da pessoa anterior não fica no navegador (pode ser um aparelho compartilhado).
    if (previousUid.current && previousUid.current !== uid) writePending(previousUid.current, null);
    previousUid.current = uid;
    setPendingAttemptState(readPending(uid));
    if (!uid) return;
    // Outra aba ou outro atalho guardou ou concluiu a tentativa: todos passam a ver a mesma.
    const onStorage = (event: StorageEvent) => { if (event.key === PENDING_KEY(uid)) setPendingAttemptState(parsePendingAttempt(event.newValue)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [uid]);
  const setPendingAttempt = useCallback((value: RepPPendingAttempt | null) => {
    setPendingAttemptState(value);
    writePending(uid, value);
  }, [uid]);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [lastMarking, setLastMarking] = useState<RepPMarkingPayload | null>(null);
  const [locationCaptureState, setLocationCaptureState] = useState<RepPLocationCaptureState>("idle");
  const locationAttempt = useRef<{ attemptId: string; unitId: string; value: RepPLocationAttemptPayload } | null>(null);
  // Diferença entre a hora oficial lida e o relógio do aparelho, medida na chegada das opções.
  const clockOffset = useRef<number | null>(null);

  const loadOptions = useCallback(async () => {
    if (!firebaseUser || !enabled) return;
    setOptionsError(null);
    try {
      const payload = await request<RepPOptionsPayload>(`/api/dp/time-recording/options?workDate=${today}`,
        { fallbackError: "Não foi possível carregar as unidades." });
      clockOffset.current = payload.officialClock?.available ? officialClockOffsetMs(payload.officialClock.instant, Date.now()) : null;
      setOptions(payload);
      setUnitIdState((current) => payload.executionUnits.some((unit) => unit.id === current) ? current : payload.executionUnits[0]?.id || "");
    } catch (error) {
      setOptionsError(errorMessageOf(error, "Não foi possível carregar as unidades."));
    }
  }, [enabled, firebaseUser, request, today]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const setUnitId = useCallback((next: string) => {
    // Com tentativa pendente a unidade fica travada na da tentativa.
    if (pendingAttempt) return;
    setUnitIdState(next);
    setAttemptId(newAttemptId());
    locationAttempt.current = null;
    setLocationCaptureState("idle");
  }, [pendingAttempt]);
  /** Limpa só o estado da janela; uma tentativa pendente continua guardada até o servidor responder. */
  const resetDialog = useCallback(() => {
    if (!pendingAttempt) {
      locationAttempt.current = null;
      setAttemptId(newAttemptId());
      setLocationCaptureState("idle");
    }
    setRecordError(null);
  }, [pendingAttempt]);

  const record = useCallback(async (declaredPurpose: RepPMarkingPurpose) => {
    // Relê o armazenamento: outro atalho pode ter guardado uma tentativa depois que esta tela abriu.
    const replaying = pendingAttempt ?? readPending(uid);
    const selectedUnitId = replaying?.unitId ?? unitId;
    if (!selectedUnitId) return;
    // No reenvio a finalidade é a da primeira tentativa: a batida pode já estar gravada com ela.
    const purpose = replaying?.purpose ?? declaredPurpose;
    const clock = options?.officialClock;
    const unit = options?.executionUnits.find((candidate) => candidate.id === selectedUnitId);
    const locationPolicy = unit?.locationPolicy;
    const zone = unit?.timeZone ?? (clock?.available ? clock.timeZone : null);
    const currentAttemptId = replaying?.attemptId ?? attemptId;
    // A data vai no fuso da unidade, o mesmo que o servidor confere; o do aparelho recusaria batidas perto da meia-noite.
    const workDate = replaying?.workDate ?? (zone ? repPDateInZone(zone) : repPLocalDate());
    setRecording(true);
    setRecordError(null);
    let captured = replaying?.location ?? (locationAttempt.current?.attemptId === currentAttemptId && locationAttempt.current.unitId === selectedUnitId
      ? locationAttempt.current.value : null);
    try {
      if (!replaying && locationPolicy && locationPolicy.mode !== "disabled" && !captured) {
        setLocationCaptureState("capturing");
        captured = await captureLocation(locationPolicy.captureTimeoutMs ?? 10_000);
        locationAttempt.current = { attemptId: currentAttemptId, unitId: selectedUnitId, value: captured };
        setLocationCaptureState(captured.status === "captured"
          ? ((captured.accuracyMeters ?? Infinity) <= (locationPolicy.maxAccuracyMeters ?? 100) ? "ready" : "imprecise") : "unavailable");
      }
      const result = await request<RepPMarkingPayload>("/api/dp/time-recording/markings", {
        method: "POST", json: { attemptId: currentAttemptId, workDate, executionUnitId: selectedUnitId,
          channel: "browser", declaredPurpose: purpose, ...(captured ? { locationAttempt: captured } : {}) },
        fallbackError: "Não foi possível registrar o ponto.",
      });
      setLastMarking(result);
      setPendingAttempt(null);
      setAttemptId(newAttemptId());
      locationAttempt.current = null;
      onRecorded?.(result);
    } catch (error) {
      const outcome = markingFailureOutcome(error, Boolean(replaying));
      if (outcome === "keep") {
        setPendingAttempt(replaying ?? { attemptId: currentAttemptId, workDate, unitId: selectedUnitId, purpose,
          firstTriedAt: clockOffset.current === null ? null : new Date(Date.now() + clockOffset.current).toISOString(), location: captured,
          savedAt: Date.now() });
        setRecordError(isAmbiguousMarkingFailure(error)
          ? "O servidor não respondeu. A batida pode ter sido gravada: reenvie a mesma batida para confirmar, sem duplicar."
          : `${errorMessageOf(error, "Não foi possível reenviar a batida.")} A tentativa continua guardada para reenviar.`);
      } else {
        // Nada foi gravado com esta tentativa (ou ela conflita com o que já está gravado): a próxima começa do zero.
        setPendingAttempt(null); setAttemptId(newAttemptId()); locationAttempt.current = null;
        setRecordError(outcome === "conflict"
          ? "Esta tentativa já tinha sido registrada de outra forma. Confira as batidas do dia antes de registrar de novo."
          : replaying ? `${errorMessageOf(error, "A tentativa anterior não foi gravada.")} A tentativa anterior não foi gravada; registre de novo.`
            : errorMessageOf(error, "Não foi possível registrar o ponto."));
      }
    } finally {
      setRecording(false);
    }
  }, [attemptId, onRecorded, options, pendingAttempt, request, setPendingAttempt, uid, unitId]);
  /** Saída explícita da pessoa, com aviso na tela: se a primeira tentativa chegou, a batida continua registrada. */
  const discardPendingAttempt = useCallback(() => {
    setPendingAttempt(null);
    setAttemptId(newAttemptId());
    locationAttempt.current = null;
    setLocationCaptureState("idle");
    setRecordError(null);
  }, [setPendingAttempt]);

  const fetchReceiptFile = useCallback(async (receiptId: string, nsr: number, markedAt: string) => {
    const blob = await request<Blob>(`/api/dp/time-recording/receipts/${receiptId}`,
      { responseType: "blob", fallbackError: "Não foi possível abrir o comprovante." });
    const suffix = options?.mode === "pilot" ? `ensaio-sequencia-${nsr}` : `nsr-${nsr}`;
    return new File([blob], `comprovante-ponto-${markedAt.slice(0, 10)}-${suffix}.pdf`, { type: "application/pdf" });
  }, [options?.mode, request]);

  // Com tentativa pendente, a unidade é a dela. Sem hora oficial nada é enviado, nem o reenvio: o servidor também recusaria.
  const effectiveUnitId = pendingAttempt?.unitId ?? unitId;
  // O relógio mostra a hora no fuso da unidade escolhida, o mesmo que a batida vai gravar.
  const unitClock = useMemo<RepPOfficialClock | null>(() => {
    const clock = options?.officialClock ?? null;
    const zone = options?.executionUnits.find((unit) => unit.id === effectiveUnitId)?.timeZone;
    return clock?.available && zone ? { ...clock, timeZone: zone } : clock;
  }, [options, effectiveUnitId]);
  const unitLocationPolicy = useMemo(() => options?.executionUnits.find((unit) => unit.id === effectiveUnitId)?.locationPolicy ?? null,
    [options, effectiveUnitId]);

  return {
    today, request, fetchReceiptFile, options, optionsError, loadOptions, unitId: effectiveUnitId, setUnitId, unitClock,
    recording, recordError, record, lastMarking, setLastMarking, locationCaptureState, unitLocationPolicy, resetDialog, pendingAttempt,
    discardPendingAttempt,
    canRecord: Boolean(effectiveUnitId) && options?.markingEnabled === true && options?.officialClock?.available === true,
  };
}
