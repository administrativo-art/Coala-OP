"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Loader2, Pencil, Search, UserRound, WalletCards } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { BeneficiaryListItem, PaymentMethod, PixKeyType } from "@/features/financial/beneficiaries/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Access = { canViewMaskedPaymentData: boolean; canManagePaymentData: boolean };
type EntityProfileResponse = {
  beneficiary: BeneficiaryListItem;
  profile: null | {
    active: boolean;
    paymentMethod: PaymentMethod;
    pixKeyType?: PixKeyType | null;
    maskedPaymentDestination?: string | null;
    holderName: string;
    holderDocumentMasked: string;
    validated: boolean;
  };
};

type FormState = {
  active: boolean;
  paymentMethod: PaymentMethod;
  pixKeyType: PixKeyType;
  destination: string;
  bankCode: string;
  agency: string;
  account: string;
  accountType: "checking" | "savings" | "payment";
  holderName: string;
  holderDocument: string;
  validated: boolean;
  keepExistingDestination: boolean;
};

const EMPTY_FORM: FormState = {
  active: true,
  paymentMethod: "pix_key",
  pixKeyType: "cnpj",
  destination: "",
  bankCode: "",
  agency: "",
  account: "",
  accountType: "checking",
  holderName: "",
  holderDocument: "",
  validated: false,
  keepExistingDestination: false,
};

async function readError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload.error || "Não foi possível concluir a operação.";
}

export default function BeneficiariesManagement() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<BeneficiaryListItem[]>([]);
  const [access, setAccess] = useState<Access>({ canViewMaskedPaymentData: false, canManagePaymentData: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "employee" | "entity">("all");
  const [selected, setSelected] = useState<BeneficiaryListItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [profileLoading, setProfileLoading] = useState(false);

  const token = useCallback(async () => {
    const value = await firebaseUser?.getIdToken();
    if (!value) throw new Error("Sessão expirada.");
    return value;
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const response = await fetch("/api/financial/beneficiaries", {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      setItems(payload.beneficiaries ?? []);
      setAccess(payload.access ?? {});
    } catch (error) {
      toast({ variant: "destructive", title: "Favorecidos indisponíveis", description: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast, token]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) =>
      (sourceFilter === "all" || item.reference.sourceType === sourceFilter) &&
      (!normalized || `${item.name} ${item.documentMasked}`.toLocaleLowerCase("pt-BR").includes(normalized)),
    );
  }, [items, search, sourceFilter]);

  const openEntity = useCallback(async (item: BeneficiaryListItem) => {
    setSelected(item);
    setProfileLoading(true);
    setForm({ ...EMPTY_FORM, holderName: item.name });
    try {
      const response = await fetch(`/api/financial/beneficiaries/entities/${encodeURIComponent(item.reference.sourceId)}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as EntityProfileResponse;
      if (payload.profile) {
        setForm({
          ...EMPTY_FORM,
          active: payload.profile.active,
          paymentMethod: payload.profile.paymentMethod,
          pixKeyType: payload.profile.pixKeyType ?? "random",
          holderName: payload.profile.holderName,
          validated: payload.profile.validated,
          keepExistingDestination: true,
        });
      }
    } catch (error) {
      toast({ variant: "destructive", title: "Perfil indisponível", description: error instanceof Error ? error.message : "Falha ao carregar." });
      setSelected(null);
    } finally {
      setProfileLoading(false);
    }
  }, [toast, token]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const destinationChanged = Boolean(form.destination || form.bankCode || form.agency || form.account);
      const payload = {
        active: form.active,
        paymentMethod: form.paymentMethod,
        pixKeyType: form.paymentMethod === "pix_key" ? form.pixKeyType : undefined,
        pixKey: form.paymentMethod === "pix_key" ? form.destination : undefined,
        pixCopyPaste: form.paymentMethod === "pix_copy_paste" ? form.destination : undefined,
        bankDetails: form.paymentMethod === "bank_details" && destinationChanged ? {
          bankCode: form.bankCode,
          agency: form.agency,
          account: form.account,
          accountType: form.accountType,
        } : undefined,
        holderName: form.holderName,
        holderDocument: form.holderDocument,
        validated: form.validated,
        keepExistingDestination: form.keepExistingDestination && !destinationChanged,
      };
      const response = await fetch(`/api/financial/beneficiaries/entities/${encodeURIComponent(selected.reference.sourceId)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readError(response));
      toast({ title: "Dados de pagamento salvos", description: "O favorecido foi atualizado com registro de auditoria." });
      setSelected(null);
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: "Não foi possível salvar", description: error instanceof Error ? error.message : "Falha ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5" /> Favorecidos de pagamentos</CardTitle>
        <CardDescription>Colaboradores usam a chave Pix do perfil de RH. Pessoas e empresas usam um perfil financeiro protegido, sem duplicação de cadastro.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Buscar por nome ou documento" />
          </div>
          <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as typeof sourceFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os favorecidos</SelectItem>
              <SelectItem value="employee">Colaboradores</SelectItem>
              <SelectItem value="entity">Pessoas e empresas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            {filtered.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhum favorecido encontrado.</p> : filtered.map((item) => (
              <div key={`${item.reference.sourceType}:${item.reference.sourceId}`} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">{item.reference.sourceType === "employee" ? <UserRound className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}</span>
                  <div className="min-w-0"><p className="truncate font-semibold">{item.name}</p><p className="text-xs text-muted-foreground">{item.reference.sourceType === "employee" ? "Colaborador" : "Pessoa/empresa"} · {item.documentMasked}</p></div>
                </div>
                <div className="text-sm">
                  <p className={item.configured ? "font-medium text-emerald-700" : "font-medium text-amber-700"}>{item.configured ? "Dados cadastrados" : "Dados pendentes"}</p>
                  {item.reference.sourceType === "employee" ? <p className="text-xs text-muted-foreground">Origem: perfil do colaborador</p> : null}
                </div>
                <div className="flex items-center justify-end gap-2">
                  {item.validated ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Validado</span> : null}
                  {access.canManagePaymentData && item.reference.sourceType === "entity" ? <Button variant="outline" size="sm" onClick={() => void openEntity(item)}><Pencil className="mr-2 h-4 w-4" /> Configurar</Button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Dados de pagamento</DialogTitle><DialogDescription>{selected?.name}. O destino é criptografado e nunca volta integralmente para o navegador.</DialogDescription></DialogHeader>
          {profileLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div className="space-y-2"><Label>Meio de pagamento</Label><Select value={form.paymentMethod} onValueChange={(value) => setForm((current) => ({ ...current, paymentMethod: value as PaymentMethod, keepExistingDestination: current.paymentMethod === value && current.keepExistingDestination }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pix_key">Chave Pix</SelectItem><SelectItem value="pix_copy_paste">Pix Copia e Cola</SelectItem><SelectItem value="bank_details">Dados bancários</SelectItem></SelectContent></Select></div>
              {form.paymentMethod === "pix_key" ? <div className="space-y-2"><Label>Tipo da chave</Label><Select value={form.pixKeyType} onValueChange={(value) => setForm((current) => ({ ...current, pixKeyType: value as PixKeyType }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cpf">CPF</SelectItem><SelectItem value="cnpj">CNPJ</SelectItem><SelectItem value="email">E-mail</SelectItem><SelectItem value="phone">Telefone</SelectItem><SelectItem value="random">Aleatória</SelectItem></SelectContent></Select></div> : <div />}
              {form.paymentMethod !== "bank_details" ? <div className="space-y-2 md:col-span-2"><Label>{form.paymentMethod === "pix_key" ? "Nova chave Pix" : "Novo Pix Copia e Cola"}</Label><Input type="text" name="new-payment-destination" autoComplete="off" spellCheck={false} data-1p-ignore="true" data-lpignore="true" value={form.destination} onChange={(event) => setForm((current) => ({ ...current, destination: event.target.value, keepExistingDestination: false, validated: false }))} placeholder={form.keepExistingDestination ? "Deixe vazio para preservar o destino atual" : "Informe o destino"} /></div> : <>
                <div className="space-y-2"><Label>Banco/ISPB</Label><Input value={form.bankCode} onChange={(event) => setForm((current) => ({ ...current, bankCode: event.target.value, keepExistingDestination: false, validated: false }))} /></div>
                <div className="space-y-2"><Label>Agência</Label><Input value={form.agency} onChange={(event) => setForm((current) => ({ ...current, agency: event.target.value, keepExistingDestination: false, validated: false }))} /></div>
                <div className="space-y-2"><Label>Conta</Label><Input value={form.account} onChange={(event) => setForm((current) => ({ ...current, account: event.target.value, keepExistingDestination: false, validated: false }))} /></div>
                <div className="space-y-2"><Label>Tipo da conta</Label><Select value={form.accountType} onValueChange={(value) => setForm((current) => ({ ...current, accountType: value as FormState["accountType"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="checking">Corrente</SelectItem><SelectItem value="savings">Poupança</SelectItem><SelectItem value="payment">Pagamento</SelectItem></SelectContent></Select></div>
              </>}
              <div className="space-y-2"><Label>Nome do titular</Label><Input value={form.holderName} onChange={(event) => setForm((current) => ({ ...current, holderName: event.target.value, validated: false }))} /></div>
              <div className="space-y-2"><Label>CPF/CNPJ do titular</Label><Input value={form.holderDocument} onChange={(event) => setForm((current) => ({ ...current, holderDocument: event.target.value, validated: false }))} placeholder="Informe novamente para confirmar" /></div>
              <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-medium">Perfil ativo</p><p className="text-xs text-muted-foreground">Disponível para novas solicitações.</p></div><Switch checked={form.active} onCheckedChange={(checked) => setForm((current) => ({ ...current, active: checked }))} /></div>
              <div className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-medium">Dados conferidos</p><p className="text-xs text-muted-foreground">Confirma titular e destino informados.</p></div><Switch checked={form.validated} onCheckedChange={(checked) => setForm((current) => ({ ...current, validated: checked }))} /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={() => void save()} disabled={saving || profileLoading}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
