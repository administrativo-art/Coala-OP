"use client";

import { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { Loader2, MapPin } from "lucide-react";

import { errorMessageOf } from "@/components/patterns/panel-form";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

import { parseMapCoordinates } from "./map-coordinates";
import { UnitLocationMap } from "./unit-location-map";

type Policy = {
  revision: number; mode: "disabled" | "observe";
  center: { latitude: number; longitude: number } | null;
  radiusMeters: number | null; maxAccuracyMeters: number | null; maxAgeSeconds: number | null;
  captureTimeoutMs: number | null;
};
type Form = {
  latitude: string; longitude: string; radiusMeters: string;
  maxAccuracyMeters: string; maxAgeSeconds: string; captureTimeoutMs: string;
};

const RADIUS_PRESETS = [50, 100, 150, 250];
const inputClass = "h-10 w-full rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-sm text-ds-ink";

function formOf(policy: Policy): Form {
  return { latitude: policy.center?.latitude.toString() ?? "", longitude: policy.center?.longitude.toString() ?? "",
    radiusMeters: policy.radiusMeters?.toString() ?? "150", maxAccuracyMeters: policy.maxAccuracyMeters?.toString() ?? "100",
    maxAgeSeconds: policy.maxAgeSeconds?.toString() ?? "60", captureTimeoutMs: policy.captureTimeoutMs?.toString() ?? "10000" };
}

const hasArea = (policy: Policy | null) => Boolean(policy && policy.mode === "observe" && policy.center);

/**
 * Área da unidade para conferir onde cada batida foi feita. Quem decide se a posição é pedida é o turno
 * (Config › DP › Turnos › Uso da localização); aqui a unidade só entrega o lugar e o raio.
 */
export function LocationPolicyControl({ firebaseUser, unitId, unitName, unitAddress, canManage, canManageAddress, onAddressSave }: {
  firebaseUser: FirebaseUser | null; unitId: string; unitName: string; canManage: boolean;
  unitAddress?: string; canManageAddress: boolean; onAddressSave: (address: string | undefined) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [savedAddress, setSavedAddress] = useState("");
  const [complement, setComplement] = useState("");
  const [coordinatesText, setCoordinatesText] = useState("");
  const [mapsBrowserApiKey, setMapsBrowserApiKey] = useState<string | null>(null);
  const getIdToken = () => firebaseUser?.getIdToken() ?? Promise.resolve(null);
  const busy = saving || removing;

  async function show() {
    const currentAddress = unitAddress?.trim() ?? "";
    setOpen(true); setLoading(true); setError(null); setConfirmingRemoval(false);
    setAddress(currentAddress); setSavedAddress(currentAddress); setComplement(""); setCoordinatesText("");
    try {
      const response = await authenticatedApiRequest<{ policy: Policy; mapsBrowserApiKey: string | null }>(`/api/dp/time-recording/location-policies/${unitId}`,
        { getIdToken, fallbackError: "Não foi possível carregar a área da unidade." });
      setPolicy(response.policy); setForm(formOf(response.policy)); setMapsBrowserApiKey(response.mapsBrowserApiKey);
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível carregar a área da unidade.")); }
    finally { setLoading(false); }
  }

  function update(patch: Partial<Form>) { setForm((current) => current ? { ...current, ...patch } : current); setError(null); }

  function pasteCoordinates(text: string) {
    setCoordinatesText(text);
    const point = parseMapCoordinates(text);
    if (point) update({ latitude: point.latitude.toFixed(7), longitude: point.longitude.toFixed(7) });
  }

  const canonicalAddress = [address.trim(), complement.trim()].filter(Boolean).join(" · ");
  const addressChanged = canonicalAddress !== savedAddress;
  const pointChosen = Boolean(form && form.latitude.trim() && form.longitude.trim()
    && Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude)));

  async function save() {
    if (!policy || !form) return;
    if (!pointChosen) { setError("Escolha o lugar na busca, clique no mapa ou arraste o pino."); return; }
    setSaving(true); setError(null);
    const numberOrNull = (value: string) => value.trim() ? Number(value) : null;
    let addressSaved = false;
    try {
      // Um só salvar: o endereço oficial só muda junto com a área, e a área só entra depois do endereço.
      if (canManageAddress && addressChanged && canonicalAddress) {
        await onAddressSave(canonicalAddress);
        addressSaved = true;
        setSavedAddress(canonicalAddress); setAddress(canonicalAddress); setComplement("");
      }
      const response = await authenticatedApiRequest<{ policy: Policy }>(`/api/dp/time-recording/location-policies/${unitId}`, {
        method: "PUT", getIdToken, fallbackError: "Não foi possível salvar a área da unidade.",
        json: { expectedRevision: policy.revision, mode: "observe",
          center: { latitude: Number(form.latitude), longitude: Number(form.longitude) },
          radiusMeters: numberOrNull(form.radiusMeters), maxAccuracyMeters: numberOrNull(form.maxAccuracyMeters),
          maxAgeSeconds: numberOrNull(form.maxAgeSeconds), captureTimeoutMs: numberOrNull(form.captureTimeoutMs),
          privacyNoticeUrl: null, legalBasisReference: null, retentionDays: 1_825, participantUserIds: [],
          // Salvar a área é a confirmação; a coleta em si continua dependendo do uso da localização em cada turno.
          activationConfirmation: true },
      });
      setPolicy(response.policy); setForm(formOf(response.policy)); setOpen(false);
    } catch (cause) {
      const message = errorMessageOf(cause, "Não foi possível salvar a área da unidade.");
      setError(addressSaved ? `O endereço foi salvo, mas a área não. Tente salvar novamente. ${message}` : message);
    }
    finally { setSaving(false); }
  }

  async function removeArea() {
    if (!policy) return;
    setRemoving(true); setError(null);
    try {
      const response = await authenticatedApiRequest<{ policy: Policy }>(`/api/dp/time-recording/location-policies/${unitId}`, {
        method: "PUT", getIdToken, fallbackError: "Não foi possível remover a área da unidade.",
        json: { expectedRevision: policy.revision, mode: "disabled", center: null, radiusMeters: null, maxAccuracyMeters: null,
          maxAgeSeconds: null, captureTimeoutMs: null, privacyNoticeUrl: null, legalBasisReference: null,
          retentionDays: null, participantUserIds: [], activationConfirmation: false },
      });
      setPolicy(response.policy); setForm(formOf(response.policy)); setConfirmingRemoval(false);
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível remover a área da unidade.")); }
    finally { setRemoving(false); }
  }

  if (!canManage) return null;
  const radius = Number(form?.radiusMeters) || 150;
  return <>
    <div className="flex items-center justify-between gap-3 rounded-ds-btn border border-ds-border bg-ds-warm p-3">
      <div><p className="text-xs font-black text-ds-ink">Área da unidade</p>
        <p className="mt-0.5 text-xs text-ds-ink-muted">Onde fica a unidade para conferir as batidas. A posição só é pedida nos turnos com localização ligada.</p></div>
      <Button type="button" variant="ds-secondary" size="sm" onClick={() => void show()}><MapPin className="h-4 w-4" /> Configurar</Button>
    </div>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3 pr-6">
            <DialogTitle>Área de ponto · {unitName}</DialogTitle>
            {form ? <StatusPill variant={hasArea(policy) ? "ok" : "neutral"}>
              {hasArea(policy) ? `Área cadastrada · ${policy?.radiusMeters ?? radius} m` : "Sem área"}</StatusPill> : null}
          </div>
          <DialogDescription>
            A unidade só diz onde fica. Quem pede a posição é o turno (Config › DP › Turnos › Uso da localização), e ela nunca impede o registro.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? <div className="grid min-h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-ds-accent-ink" /></div> : null}
          {!loading && form ? <div className="space-y-4">
            <UnitLocationMap apiKey={mapsBrowserApiKey}
              center={pointChosen ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null}
              radiusMeters={radius}
              onPoint={(point) => update({ latitude: point.latitude.toFixed(7), longitude: point.longitude.toFixed(7) })}
              onAddress={(formatted) => setAddress(formatted)} />

            <div className="flex items-start gap-2 rounded-ds-btn border border-ds-border bg-ds-warm p-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ds-ink-muted" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="text-xs font-bold text-ds-ink-muted">Endereço da unidade</p>
                <p className="break-words font-semibold text-ds-ink">{address.trim() || "Escolha um lugar na busca acima."}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="block space-y-1 text-xs font-bold text-ds-ink-muted">Complemento
                <input className={inputClass} value={complement} placeholder="Ex.: Quiosque L1, loja 12"
                  onChange={(event) => { setComplement(event.target.value); setError(null); }} />
              </label>
              <div className="space-y-1 text-xs font-bold text-ds-ink-muted">
                <span>Raio da área (m)</span>
                <div className="flex items-center gap-1.5">
                  {RADIUS_PRESETS.map((value) => <button key={value} type="button" aria-pressed={Number(form.radiusMeters) === value}
                    onClick={() => update({ radiusMeters: String(value) })}
                    className={`h-10 rounded-ds-btn border px-3 text-sm font-semibold ${Number(form.radiusMeters) === value
                      ? "border-ds-ink bg-ds-ink text-ds-surface" : "border-ds-border-input bg-ds-surface text-ds-ink"}`}>{value}</button>)}
                  <input className={`${inputClass} w-20`} inputMode="numeric" aria-label="Raio em metros" value={form.radiusMeters}
                    onChange={(event) => update({ radiusMeters: event.target.value })} />
                </div>
              </div>
            </div>
            <p className="text-xs text-ds-ink-muted">
              {canManageAddress ? "O endereço acima e o complemento passam a ser o endereço oficial da unidade e vão para os documentos."
                : "Somente quem administra o cadastro de unidades pode substituir o endereço oficial; a área é salva mesmo assim."}
              {" "}Um raio menor aumenta falsos alertas em ambientes cobertos.
            </p>

            <details className="rounded-ds-btn border border-ds-border p-3">
              <summary className="cursor-pointer text-xs font-bold text-ds-ink-muted">Ajustes avançados</summary>
              <div className="mt-3 space-y-3">
                <label className="block space-y-1 text-xs font-bold text-ds-ink-muted">Colar coordenadas ou link do Google Maps
                  <input className={inputClass} value={coordinatesText} placeholder="-2.5307, -44.3068"
                    onChange={(event) => pasteCoordinates(event.target.value)} />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Latitude
                    <input className={inputClass} inputMode="decimal" value={form.latitude} onChange={(e) => update({ latitude: e.target.value })} /></label>
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Longitude
                    <input className={inputClass} inputMode="decimal" value={form.longitude} onChange={(e) => update({ longitude: e.target.value })} /></label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Precisão máxima (m)
                    <input className={inputClass} inputMode="numeric" value={form.maxAccuracyMeters} onChange={(e) => update({ maxAccuracyMeters: e.target.value })} /></label>
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Idade máxima da leitura (s)
                    <input className={inputClass} inputMode="numeric" value={form.maxAgeSeconds} onChange={(e) => update({ maxAgeSeconds: e.target.value })} /></label>
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Tempo limite da captura (ms)
                    <input className={inputClass} inputMode="numeric" value={form.captureTimeoutMs} onChange={(e) => update({ captureTimeoutMs: e.target.value })} /></label>
                </div>
                <p className="text-xs text-ds-ink-muted">A posição é guardada por 1.825 dias (cinco anos), conforme a política central.</p>
              </div>
            </details>

            {confirmingRemoval ? <InlineConfirm message="Remover a área? As batidas deixam de ser conferidas com esta unidade."
              confirmLabel="Remover" loadingLabel="Removendo…" loading={removing} onConfirm={() => void removeArea()}
              onCancel={() => setConfirmingRemoval(false)} /> : null}
          </div> : null}
        </div>
        <footer className="border-t px-5 py-3">{error ? <p role="alert" className="mb-2 text-xs font-semibold text-ds-danger">{error}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <div>{hasArea(policy) && !confirmingRemoval ? <Button variant="ds-ghost" disabled={busy}
              onClick={() => setConfirmingRemoval(true)}>Remover área</Button> : null}</div>
            <div className="flex gap-2">
              <Button variant="ds-ghost" disabled={busy} onClick={() => setOpen(false)}>Fechar</Button>
              <Button variant="primary-modal" loading={saving} loadingLabel="Salvando…" disabled={!form || loading || removing || !pointChosen}
                onClick={() => void save()}>Salvar</Button>
            </div>
          </div></footer>
      </DialogContent>
    </Dialog>
  </>;
}
