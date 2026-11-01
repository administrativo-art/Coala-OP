"use client";

import { useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { Loader2, MapPin } from "lucide-react";

import { errorMessageOf } from "@/components/patterns/panel-form";
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
  captureTimeoutMs: number | null; privacyNoticeUrl: string | null; legalBasisReference: string | null;
  retentionDays: number | null; participantUserIds: string[];
};
type Form = {
  mode: Policy["mode"]; latitude: string; longitude: string; radiusMeters: string;
  maxAccuracyMeters: string; maxAgeSeconds: string; captureTimeoutMs: string;
  legalBasisReference: string; participantUserIds: string[];
  activationConfirmation: boolean;
};

function formOf(policy: Policy): Form {
  return { mode: policy.mode, latitude: policy.center?.latitude.toString() ?? "",
    longitude: policy.center?.longitude.toString() ?? "", radiusMeters: policy.radiusMeters?.toString() ?? "150",
    maxAccuracyMeters: policy.maxAccuracyMeters?.toString() ?? "100", maxAgeSeconds: policy.maxAgeSeconds?.toString() ?? "60",
    captureTimeoutMs: policy.captureTimeoutMs?.toString() ?? "10000",
    legalBasisReference: policy.legalBasisReference ?? "",
    participantUserIds: policy.participantUserIds ?? [], activationConfirmation: false };
}

const inputClass = "h-10 w-full rounded-ds-btn border border-ds-border-input bg-ds-surface px-3 text-sm text-ds-ink";

export function LocationPolicyControl({ firebaseUser, unitId, unitName, unitAddress, canManage, canManageAddress, participants, onAddressSave }: {
  firebaseUser: FirebaseUser | null; unitId: string; unitName: string; canManage: boolean;
  participants: Array<{ id: string; name: string }>;
  unitAddress?: string; canManageAddress: boolean; onAddressSave: (address: string | undefined) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapText, setMapText] = useState("");
  const [addressComplement, setAddressComplement] = useState("");
  const [savedAddress, setSavedAddress] = useState("");
  const [mapPlaceSelected, setMapPlaceSelected] = useState(false);
  const [mapsBrowserApiKey, setMapsBrowserApiKey] = useState<string | null>(null);
  const getIdToken = () => firebaseUser?.getIdToken() ?? Promise.resolve(null);

  async function show() {
    const currentAddress = unitAddress?.trim() ?? "";
    setOpen(true); setLoading(true); setError(null); setMapText(currentAddress); setSavedAddress(currentAddress);
    setAddressComplement(""); setMapPlaceSelected(Boolean(currentAddress));
    try {
      const response = await authenticatedApiRequest<{ policy: Policy; mapsBrowserApiKey: string | null }>(`/api/dp/time-recording/location-policies/${unitId}`,
        { getIdToken, fallbackError: "Não foi possível carregar a configuração de localização." });
      setPolicy(response.policy); setForm(formOf(response.policy)); setMapsBrowserApiKey(response.mapsBrowserApiKey);
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível carregar a configuração de localização.")); }
    finally { setLoading(false); }
  }

  function update(patch: Partial<Form>) { setForm((current) => current ? { ...current, ...patch } : current); setError(null); }

  function pasteMap(text: string) {
    setMapText(text); setMapPlaceSelected(false);
    const point = parseMapCoordinates(text);
    if (point) update({ latitude: point.latitude.toFixed(7), longitude: point.longitude.toFixed(7) });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setError("Este navegador não oferece localização."); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition((position) => {
      update({ latitude: position.coords.latitude.toFixed(7), longitude: position.coords.longitude.toFixed(7) });
      setLocating(false);
    }, (cause) => { setError(cause.code === cause.PERMISSION_DENIED ? "Permita a localização para preencher as coordenadas."
      : "Não foi possível obter a localização desta unidade."); setLocating(false); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  }

  async function save() {
    if (!policy || !form) return;
    setSaving(true); setError(null);
    const numberOrNull = (value: string) => value.trim() ? Number(value) : null;
    try {
      const active = form.mode !== "disabled";
      const response = await authenticatedApiRequest<{ policy: Policy }>(`/api/dp/time-recording/location-policies/${unitId}`, {
        method: "PUT", getIdToken, fallbackError: "Não foi possível salvar a configuração de localização.",
        json: { expectedRevision: policy.revision, mode: form.mode,
          center: form.latitude.trim() && form.longitude.trim()
            ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null,
          radiusMeters: numberOrNull(form.radiusMeters), maxAccuracyMeters: numberOrNull(form.maxAccuracyMeters),
          maxAgeSeconds: numberOrNull(form.maxAgeSeconds), captureTimeoutMs: numberOrNull(form.captureTimeoutMs),
          privacyNoticeUrl: null,
          legalBasisReference: form.legalBasisReference.trim() || null,
          retentionDays: 1_825, participantUserIds: form.participantUserIds,
          activationConfirmation: active && form.activationConfirmation },
      });
      setPolicy(response.policy); setForm(formOf(response.policy));
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível salvar a configuração de localização.")); }
    finally { setSaving(false); }
  }

  async function saveAddress() {
    const canonicalAddress = [mapText.trim(), addressComplement.trim()].filter(Boolean).join(" · ");
    if (canonicalAddress === savedAddress) return;
    setSavingAddress(true); setError(null);
    try {
      await onAddressSave(canonicalAddress || undefined);
      setSavedAddress(canonicalAddress); setMapText(canonicalAddress); setAddressComplement(""); setMapPlaceSelected(true);
    } catch (cause) { setError(errorMessageOf(cause, "Não foi possível salvar o endereço da unidade.")); }
    finally { setSavingAddress(false); }
  }

  if (!canManage) return null;
  return <>
    <div className="flex items-center justify-between gap-3 rounded-ds-btn border border-ds-border bg-ds-warm p-3">
      <div><p className="text-xs font-black text-ds-ink">Localização da unidade</p>
        <p className="mt-0.5 text-xs text-ds-ink-muted">Onde fica a unidade e se a posição é pedida ao bater o ponto.</p></div>
      <Button type="button" variant="ds-secondary" size="sm" onClick={() => void show()}><MapPin className="h-4 w-4" /> Configurar</Button>
    </div>
    <Dialog open={open} onOpenChange={(next) => { if (!saving && !locating) setOpen(next); }}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4"><DialogTitle>Localização · {unitName}</DialogTitle>
          <DialogDescription>Com a coleta ligada, a posição é pedida só ao confirmar a batida e nunca impede o registro.</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? <div className="grid min-h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-ds-accent-ink" /></div> : null}
          {!loading && form ? <div className="space-y-5">
            <section className="space-y-3" aria-labelledby="unit-area-title">
              <div>
                <h3 id="unit-area-title" className="text-sm font-extrabold text-ds-ink">Onde fica a unidade</h3>
                <p className="text-xs text-ds-ink-muted">Área usada para conferir onde cada batida foi feita. Cadastrar a área não liga a coleta.</p>
              </div>
              <UnitLocationMap apiKey={mapsBrowserApiKey}
                center={form.latitude.trim() && form.longitude.trim() ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null}
                radiusMeters={Number(form.radiusMeters) || 150}
                onPoint={(point) => update({ latitude: point.latitude.toFixed(7), longitude: point.longitude.toFixed(7) })}
                onAddress={(address) => { setMapText(address); setMapPlaceSelected(true); }} />
              <label className="block space-y-1 text-xs font-bold text-ds-ink-muted">Endereço da unidade
                <input className={inputClass} value={mapText} placeholder="Busque acima ou cole coordenadas do Google Maps"
                  onChange={(e) => pasteMap(e.target.value)} />
                <span className="block font-semibold">{mapText.trim() && !mapPlaceSelected && !parseMapCoordinates(mapText)
                  ? "Não encontrei coordenadas. Abra o link curto no navegador e cole o endereço completo, ou cole latitude e longitude."
                  : "Usa o pino do lugar, não o centro da tela."}</span>
              </label>
              <label className="block space-y-1 text-xs font-bold text-ds-ink-muted">Complemento
                <input className={inputClass} value={addressComplement} placeholder="Ex.: Quiosque L1, loja 12"
                  onChange={(event) => { setAddressComplement(event.target.value); setError(null); }} />
                <span className="block font-semibold">O endereço acima, junto com este complemento, substitui o endereço atual da unidade e passa a ser usado nos documentos.</span>
              </label>
              {canManageAddress ? <Button type="button" variant="ds-secondary" size="sm" loading={savingAddress}
                loadingLabel="Salvando endereço…" disabled={saving || !mapText.trim() || [mapText.trim(), addressComplement.trim()].filter(Boolean).join(" · ") === savedAddress}
                onClick={() => void saveAddress()}>Salvar endereço da unidade</Button>
                : <p className="text-xs text-ds-ink-muted">Somente quem administra o cadastro de unidades pode substituir o endereço oficial.</p>}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Latitude<input className={inputClass} inputMode="decimal" value={form.latitude} onChange={(e) => update({ latitude: e.target.value })} /></label>
                <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Longitude<input className={inputClass} inputMode="decimal" value={form.longitude} onChange={(e) => update({ longitude: e.target.value })} /></label>
                <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Raio (m)<input className={inputClass} inputMode="numeric" value={form.radiusMeters} onChange={(e) => update({ radiusMeters: e.target.value })} /></label>
              </div>
              <Button type="button" variant="ds-secondary" size="sm" loading={locating} loadingLabel="Localizando…" onClick={useCurrentLocation}>Usar minha localização</Button>
              <p className="rounded-ds-btn border border-ds-warn bg-ds-warn-bg p-3 text-xs text-ds-warn">Um raio menor aumenta falsos alertas em ambientes cobertos. Resultado externo ou impreciso nunca bloqueia o ponto.</p>
            </section>
            <section className="space-y-3 border-t border-ds-divider pt-4" aria-labelledby="unit-collection-title">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="unit-collection-title" className="text-sm font-extrabold text-ds-ink">Coleta no registro de ponto</h3>
                  <p className="text-xs text-ds-ink-muted">Quem tem a posição pedida ao bater o ponto nesta unidade.</p>
                </div>
                <StatusPill variant={form.mode === "observe" ? "info" : "neutral"}>{form.mode === "observe" ? "Observação" : "Desligada"}</StatusPill>
              </div>
              <label className="block space-y-1 text-xs font-bold text-ds-ink-muted">Modo
                <select className={`${inputClass} max-w-48`} value={form.mode} onChange={(event) => update({ mode: event.target.value as Form["mode"], activationConfirmation: false })}>
                  <option value="disabled">Desligada</option><option value="observe">Observação</option>
                </select></label>
              {form.mode === "observe" ? <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Precisão máxima (m)<input className={inputClass} inputMode="numeric" value={form.maxAccuracyMeters} onChange={(e) => update({ maxAccuracyMeters: e.target.value })} /></label>
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Idade máxima da leitura (s)<input className={inputClass} inputMode="numeric" value={form.maxAgeSeconds} onChange={(e) => update({ maxAgeSeconds: e.target.value })} /></label>
                  <label className="space-y-1 text-xs font-bold text-ds-ink-muted">Tempo limite da captura (ms)<input className={inputClass} inputMode="numeric" value={form.captureTimeoutMs} onChange={(e) => update({ captureTimeoutMs: e.target.value })} /></label>
                </div>
                <label className="block space-y-1 text-xs font-bold text-ds-ink-muted">Base jurídica aprovada<input className={inputClass} value={form.legalBasisReference} onChange={(e) => update({ legalBasisReference: e.target.value })} placeholder="Referência da decisão do jurídico/DPO" /></label>
                <div className="rounded-ds-btn border border-ds-border bg-ds-warm p-3 text-xs text-ds-ink">
                  <span className="font-bold">Guarda da coordenada:</span> 1.825 dias (cinco anos), conforme a política central.
                </div>
                <fieldset className="space-y-2 rounded-ds-btn border border-ds-border p-3">
                  <legend className="px-1 text-xs font-bold text-ds-ink-muted">Participantes do piloto</legend>
                  <p className="text-xs text-ds-ink-muted">A unidade pode ficar ativa, mas somente as pessoas marcadas terão localização solicitada.</p>
                  {participants.length ? <div className="grid gap-2 sm:grid-cols-2">{participants.map((person) => {
                    const checked = form.participantUserIds.includes(person.id);
                    return <label key={person.id} className="flex items-center gap-2 text-sm text-ds-ink">
                      <input type="checkbox" checked={checked} onChange={() => update({ participantUserIds: checked
                        ? form.participantUserIds.filter((id) => id !== person.id) : [...form.participantUserIds, person.id] })} />
                      <span className="truncate">{person.name}</span>
                    </label>;
                  })}</div> : <p className="text-xs font-semibold text-ds-warn">Nenhum colaborador ativo está vinculado a esta unidade.</p>}
                </fieldset>
                <label className="flex items-start gap-2 rounded-ds-btn border border-ds-info bg-ds-info-bg p-3 text-xs font-semibold text-ds-ink">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.activationConfirmation} onChange={(e) => update({ activationConfirmation: e.target.checked })} />
                  Confirmo que aviso, base jurídica, RIPD, prazo de guarda e parâmetros físicos desta unidade foram aprovados para o piloto.</label>
              </> : <p className="text-xs text-ds-ink-muted">Desligada: ninguém tem a posição pedida nesta unidade. A área acima fica guardada para quando a coleta for ligada.</p>}
            </section>
          </div> : null}
        </div>
        <footer className="border-t px-5 py-3">{error ? <p role="alert" className="mb-2 text-xs font-semibold text-ds-danger">{error}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="ds-ghost" disabled={saving || savingAddress || locating} onClick={() => setOpen(false)}>Fechar</Button>
            <Button variant="primary-modal" loading={saving} loadingLabel="Salvando…" disabled={!form || loading || (form.mode === "observe" && !form.activationConfirmation)} onClick={() => void save()}>Salvar localização</Button></div></footer>
      </DialogContent>
    </Dialog>
  </>;
}
