"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, Loader2, MapPin, Pencil, Plus, Stethoscope } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type EntityOption = { id: string; name: string; documentMasked: string };
type Clinic = {
  id: string;
  entityId: string;
  active: boolean;
  asoPrice: number;
  defaultPaymentDescription: string;
  schedulingEmail: string;
  address: {
    street: string; number: string; complement?: string; district: string; city: string;
    state: string; postalCode: string; reference?: string; mapsUrl?: string;
  };
  entity?: { name: string; documentMasked: string; status: string } | null;
  paymentProfile?: { configured: boolean; active: boolean; validated: boolean; maskedPaymentDestination?: string | null };
};

type FormState = {
  entityId: string; active: boolean; asoPrice: string; defaultPaymentDescription: string; schedulingEmail: string;
  street: string; number: string; complement: string; district: string; city: string; state: string;
  postalCode: string; reference: string; mapsUrl: string;
};

const EMPTY: FormState = {
  entityId: "", active: true, asoPrice: "", defaultPaymentDescription: "Pagamento de ASO admissional",
  schedulingEmail: "", street: "", number: "", complement: "", district: "", city: "", state: "MA",
  postalCode: "", reference: "", mapsUrl: "",
};

async function readError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error || "Não foi possível concluir a operação.";
}

type ClinicEntity = {
  id: string;
  name: string;
  fantasyName?: string;
  document?: string;
  contact?: { email?: string };
  address?: {
    street?: string; number?: string; complement?: string; neighborhood?: string;
    city?: string; state?: string; zipCode?: string;
  };
};

function formForEntity(entity: ClinicEntity, clinic?: Clinic): FormState {
  if (clinic) {
    return {
      entityId: clinic.entityId,
      active: clinic.active,
      asoPrice: String(clinic.asoPrice ?? ""),
      defaultPaymentDescription: clinic.defaultPaymentDescription ?? "",
      schedulingEmail: clinic.schedulingEmail ?? "",
      street: clinic.address?.street ?? "",
      number: clinic.address?.number ?? "",
      complement: clinic.address?.complement ?? "",
      district: clinic.address?.district ?? "",
      city: clinic.address?.city ?? "",
      state: clinic.address?.state ?? "MA",
      postalCode: clinic.address?.postalCode ?? "",
      reference: clinic.address?.reference ?? "",
      mapsUrl: clinic.address?.mapsUrl ?? "",
    };
  }
  return {
    ...EMPTY,
    entityId: entity.id,
    schedulingEmail: entity.contact?.email ?? "",
    street: entity.address?.street ?? "",
    number: entity.address?.number ?? "",
    complement: entity.address?.complement ?? "",
    district: entity.address?.neighborhood ?? "",
    city: entity.address?.city ?? "",
    state: entity.address?.state ?? "MA",
    postalCode: entity.address?.zipCode ?? "",
  };
}

export function AsoClinicEntityDialog({
  entity,
  open,
  onOpenChange,
  onSaved,
}: {
  entity: ClinicEntity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (clinic: Clinic) => void;
}) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!open || !entity || !firebaseUser) return;
    let cancelled = false;
    setLoading(true);
    void firebaseUser.getIdToken()
      .then((token) => fetch("/api/hr/aso-clinics", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }))
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const current = (payload.clinics ?? []).find((item: Clinic) => item.entityId === entity.id) ?? null;
        setClinic(current);
        setForm(formForEntity(entity, current ?? undefined));
      })
      .catch((error) => {
        if (!cancelled) toast({
          variant: "destructive",
          title: "Configuração de ASO indisponível",
          description: error instanceof Error ? error.message : "Falha ao carregar.",
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entity, firebaseUser, open, toast]);

  async function save() {
    if (!entity || !firebaseUser) return;
    setSaving(true);
    try {
      const response = await fetch("/api/hr/aso-clinics", {
        method: "POST",
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: entity.id,
          active: form.active,
          asoPrice: Number(form.asoPrice.replace(",", ".")),
          defaultPaymentDescription: form.defaultPaymentDescription,
          schedulingEmail: form.schedulingEmail,
          address: {
            street: form.street, number: form.number, complement: form.complement || undefined,
            district: form.district, city: form.city, state: form.state, postalCode: form.postalCode,
            reference: form.reference || undefined, mapsUrl: form.mapsUrl || undefined,
          },
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      const saved = { ...payload.clinic, entity: clinic?.entity, paymentProfile: clinic?.paymentProfile } as Clinic;
      setClinic(saved);
      onSaved?.(saved);
      toast({ title: "Serviço de ASO salvo", description: "A configuração foi vinculada a este mesmo fornecedor." });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível salvar", description: error instanceof Error ? error.message : "Falha ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Serviços de saúde ocupacional</DialogTitle>
          <DialogDescription>
            Configuração de ASO vinculada ao cadastro de {entity?.fantasyName || entity?.name || "fornecedor"}. Nome e CPF/CNPJ permanecem no cadastro principal.
          </DialogDescription>
        </DialogHeader>
        {loading ? <div className="grid min-h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="rounded-xl border bg-muted/30 p-3 md:col-span-2">
              <p className="font-semibold">{entity?.fantasyName || entity?.name}</p>
              <p className="text-xs text-muted-foreground">{entity?.document || "Documento não informado"}</p>
            </div>
            <div className="space-y-2"><Label>Valor padrão do ASO</Label><Input inputMode="decimal" value={form.asoPrice} onChange={(event) => set("asoPrice", event.target.value)} placeholder="0,00" /></div>
            <div className="space-y-2"><Label>E-mail de agendamento</Label><Input type="email" value={form.schedulingEmail} onChange={(event) => set("schedulingEmail", event.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Descrição padrão do pagamento</Label><Input value={form.defaultPaymentDescription} onChange={(event) => set("defaultPaymentDescription", event.target.value)} /></div>
            <div className="space-y-2"><Label>Logradouro da clínica</Label><Input value={form.street} onChange={(event) => set("street", event.target.value)} /></div>
            <div className="space-y-2"><Label>Número</Label><Input value={form.number} onChange={(event) => set("number", event.target.value)} /></div>
            <div className="space-y-2"><Label>Complemento</Label><Input value={form.complement} onChange={(event) => set("complement", event.target.value)} /></div>
            <div className="space-y-2"><Label>Bairro</Label><Input value={form.district} onChange={(event) => set("district", event.target.value)} /></div>
            <div className="space-y-2"><Label>Cidade</Label><Input value={form.city} onChange={(event) => set("city", event.target.value)} /></div>
            <div className="grid grid-cols-[100px_1fr] gap-3"><div className="space-y-2"><Label>UF</Label><Input maxLength={2} value={form.state} onChange={(event) => set("state", event.target.value.toUpperCase())} /></div><div className="space-y-2"><Label>CEP</Label><Input value={form.postalCode} onChange={(event) => set("postalCode", event.target.value)} /></div></div>
            <div className="space-y-2 md:col-span-2"><Label>Referência</Label><Input value={form.reference} onChange={(event) => set("reference", event.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Link do Google Maps</Label><Input value={form.mapsUrl} onChange={(event) => set("mapsUrl", event.target.value)} /></div>
            <div className="flex items-center justify-between rounded-xl border p-3 md:col-span-2"><div><p className="text-sm font-medium">Disponível para novos ASOs</p><p className="text-xs text-muted-foreground">O RH poderá selecionar este fornecedor na integração.</p></div><Switch checked={form.active} onCheckedChange={(checked) => set("active", checked)} /></div>
            <div className="rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-900 md:col-span-2">
              A chave Pix e sua validação continuam protegidas no perfil financeiro deste mesmo fornecedor.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={loading || saving || !entity}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar configuração de ASO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AsoClinicsManagement() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const token = useCallback(async () => {
    const value = await firebaseUser?.getIdToken();
    if (!value) throw new Error("Sessão expirada.");
    return value;
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const response = await fetch("/api/hr/aso-clinics", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      setClinics(payload.clinics ?? []);
      setEntities(payload.entities ?? []);
      setCanManage(payload.access?.canManage === true);
    } catch (error) {
      toast({ variant: "destructive", title: "Clínicas indisponíveis", description: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast, token]);

  useEffect(() => { void load(); }, [load]);

  function create() {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function edit(clinic: Clinic) {
    setEditingId(clinic.id);
    setForm({
      entityId: clinic.entityId,
      active: clinic.active,
      asoPrice: String(clinic.asoPrice ?? ""),
      defaultPaymentDescription: clinic.defaultPaymentDescription ?? "",
      schedulingEmail: clinic.schedulingEmail ?? "",
      street: clinic.address?.street ?? "",
      number: clinic.address?.number ?? "",
      complement: clinic.address?.complement ?? "",
      district: clinic.address?.district ?? "",
      city: clinic.address?.city ?? "",
      state: clinic.address?.state ?? "MA",
      postalCode: clinic.address?.postalCode ?? "",
      reference: clinic.address?.reference ?? "",
      mapsUrl: clinic.address?.mapsUrl ?? "",
    });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/hr/aso-clinics", {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: form.entityId,
          active: form.active,
          asoPrice: Number(form.asoPrice.replace(",", ".")),
          defaultPaymentDescription: form.defaultPaymentDescription,
          schedulingEmail: form.schedulingEmail,
          address: {
            street: form.street, number: form.number, complement: form.complement || undefined,
            district: form.district, city: form.city, state: form.state, postalCode: form.postalCode,
            reference: form.reference || undefined, mapsUrl: form.mapsUrl || undefined,
          },
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      toast({ title: "Clínica salva", description: "A configuração do ASO foi atualizada com auditoria." });
      setOpen(false);
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível salvar", description: error instanceof Error ? error.message : "Falha ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  const set = (key: keyof FormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div><CardTitle className="flex items-center gap-2"><Stethoscope className="h-5 w-5" /> Clínicas de ASO</CardTitle><CardDescription>Configuração operacional vinculada a Pessoas e empresas. O Pix é mantido separadamente pelo Financeiro.</CardDescription></div>
          {canManage ? <Button onClick={create}><Plus className="mr-2 h-4 w-4" /> Adicionar clínica</Button> : null}
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : clinics.length === 0 ? <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhuma clínica de ASO configurada.</p> : (
            <div className="grid gap-4 lg:grid-cols-2">
              {clinics.map((clinic) => <div key={clinic.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Building2 className="h-5 w-5" /></span><div><p className="font-semibold">{clinic.entity?.name ?? "Clínica não encontrada"}</p><p className="text-xs text-muted-foreground">{clinic.entity?.documentMasked}</p></div></div>{canManage ? <Button size="icon" variant="ghost" onClick={() => edit(clinic)}><Pencil className="h-4 w-4" /></Button> : null}</div>
                <div className="mt-4 space-y-2 text-sm"><p><strong>ASO:</strong> {clinic.asoPrice?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p><p><strong>Agendamento:</strong> {clinic.schedulingEmail}</p><p className="flex gap-1"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {clinic.address?.street}, {clinic.address?.number} · {clinic.address?.district} · {clinic.address?.city}/{clinic.address?.state}</p></div>
                <div className={`mt-4 rounded-lg p-3 text-xs font-medium ${clinic.paymentProfile?.configured && clinic.paymentProfile?.validated ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{clinic.paymentProfile?.configured && clinic.paymentProfile?.validated ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Favorecido financeiro configurado e validado</span> : "Dados de pagamento pendentes no Financeiro"}</div>
              </div>)}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Editar clínica de ASO" : "Adicionar clínica de ASO"}</DialogTitle><DialogDescription>Selecione um cadastro central e informe somente os dados específicos do serviço ocupacional.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2"><Label>Pessoa/empresa</Label><Select disabled={Boolean(editingId)} value={form.entityId} onValueChange={(value) => set("entityId", value)}><SelectTrigger><SelectValue placeholder="Selecione a clínica cadastrada" /></SelectTrigger><SelectContent>{entities.map((entity) => <SelectItem key={entity.id} value={entity.id}>{entity.name} · {entity.documentMasked}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Valor do ASO</Label><Input inputMode="decimal" value={form.asoPrice} onChange={(event) => set("asoPrice", event.target.value)} placeholder="0,00" /></div>
            <div className="space-y-2"><Label>E-mail de agendamento</Label><Input type="email" value={form.schedulingEmail} onChange={(event) => set("schedulingEmail", event.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Descrição padrão do pagamento</Label><Input value={form.defaultPaymentDescription} onChange={(event) => set("defaultPaymentDescription", event.target.value)} /></div>
            <div className="space-y-2"><Label>Logradouro</Label><Input value={form.street} onChange={(event) => set("street", event.target.value)} /></div>
            <div className="space-y-2"><Label>Número</Label><Input value={form.number} onChange={(event) => set("number", event.target.value)} /></div>
            <div className="space-y-2"><Label>Complemento</Label><Input value={form.complement} onChange={(event) => set("complement", event.target.value)} /></div>
            <div className="space-y-2"><Label>Bairro</Label><Input value={form.district} onChange={(event) => set("district", event.target.value)} /></div>
            <div className="space-y-2"><Label>Cidade</Label><Input value={form.city} onChange={(event) => set("city", event.target.value)} /></div>
            <div className="grid grid-cols-[100px_1fr] gap-3"><div className="space-y-2"><Label>UF</Label><Input maxLength={2} value={form.state} onChange={(event) => set("state", event.target.value.toUpperCase())} /></div><div className="space-y-2"><Label>CEP</Label><Input value={form.postalCode} onChange={(event) => set("postalCode", event.target.value)} /></div></div>
            <div className="space-y-2 md:col-span-2"><Label>Referência</Label><Input value={form.reference} onChange={(event) => set("reference", event.target.value)} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Link do Google Maps</Label><Input value={form.mapsUrl} onChange={(event) => set("mapsUrl", event.target.value)} /></div>
            <div className="flex items-center justify-between rounded-xl border p-3 md:col-span-2"><div><p className="text-sm font-medium">Clínica ativa</p><p className="text-xs text-muted-foreground">Disponível em novas integrações.</p></div><Switch checked={form.active} onCheckedChange={(checked) => set("active", checked)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
