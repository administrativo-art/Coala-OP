"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import type { FinancialInboxMessage, FinancialInboxStatus } from "./types";
import { PageContainer } from "@/components/layout/page-container";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_LABEL: Record<FinancialInboxStatus, string> = {
  pending_review: "Aguardando revisão",
  document_pending: "Documento pendente",
  linked: "Vinculada",
  ignored: "Ignorada",
  error: "Erro",
};

const TYPE_LABEL: Record<FinancialInboxMessage["classification"]["documentType"], string> = {
  fgts: "FGTS",
  inss_darf: "INSS / DARF",
  accounting_fee: "Honorário contábil",
  tax: "Tributo",
  utility_bill: "Conta de consumo",
  charge: "Cobrança",
  other: "A classificar",
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCompetence(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}

function formatAmount(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function senderLabel(message: FinancialInboxMessage) {
  return message.classification.supplierName || message.from;
}

export function FinancialInboxPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<FinancialInboxMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  const canReview = Boolean(permissions.financial?.expenses?.edit);
  const selected = useMemo(() => messages.find((message) => message.id === selectedId) ?? null, [messages, selectedId]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Falha na operação.");
    return payload;
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (status !== "all") query.set("status", status);
      if (cursor) query.set("cursor", cursor);
      const payload = await api(`/api/financial/inbox?${query.toString()}`);
      const nextMessages = (payload.messages ?? []) as FinancialInboxMessage[];
      setMessages(nextMessages);
      setNextCursor(payload.nextCursor ?? null);
      setSelectedId((current) => nextMessages.some((message) => message.id === current) ? current : nextMessages[0]?.id ?? null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar cobranças." });
    } finally {
      setLoading(false);
    }
  }, [api, cursor, firebaseUser, status, toast]);

  useEffect(() => { void load(); }, [load]);

  function changeStatus(nextStatus: string) {
    setStatus(nextStatus);
    setCursor(null);
    setCursorStack([]);
    setNextCursor(null);
  }

  async function review(message: FinancialInboxMessage, nextStatus: "pending_review" | "ignored") {
    setWorking(`review:${message.id}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      toast({ title: nextStatus === "ignored" ? "Mensagem ignorada sem gerar despesa." : "Mensagem reaberta para revisão." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao revisar mensagem." });
    } finally {
      setWorking(null);
    }
  }

  async function openFile(message: FinancialInboxMessage, fileId: string) {
    if (!firebaseUser) return;
    const preview = window.open("", "_blank");
    setWorking(`file:${fileId}`);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/financial/inbox/${encodeURIComponent(message.id)}/files/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Falha ao abrir o arquivo.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (preview) preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview?.close();
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir o arquivo." });
    } finally {
      setWorking(null);
    }
  }

  if (!permissions.financial?.expenses?.view) {
    return <FinancialAccessGuard title="Caixa de cobranças" description="Seu perfil não possui permissão para consultar cobranças recebidas." />;
  }

  return (
    <PageContainer variant="wide" className="space-y-5 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Inbox className="h-6 w-6" />Caixa de cobranças</h1>
          <p className="mt-1 text-sm text-muted-foreground">Documentos recebidos por e-mail, arquivados para conferência antes de qualquer lançamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={changeStatus}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as mensagens</SelectItem>
              <SelectItem value="pending_review">Aguardando revisão</SelectItem>
              <SelectItem value="document_pending">Documento pendente</SelectItem>
              <SelectItem value="ignored">Ignoradas</SelectItem>
              <SelectItem value="linked">Vinculadas</SelectItem>
              <SelectItem value="error">Com erro</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <div><strong>Entrada protegida.</strong> O recebimento não cria despesa, não autoriza pagamento e não envia nada ao banco. O e-mail original continua no Google.</div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : messages.length === 0 ? (
        <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><Inbox className="h-9 w-9 text-muted-foreground" /><p className="font-semibold">Nenhuma mensagem neste filtro</p><p className="text-sm text-muted-foreground">Novas cobranças aparecerão aqui depois que a regra do Google for ativada.</p></CardContent></Card>
      ) : (
        <div className="grid min-h-[560px] gap-4 lg:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
          <div className="space-y-2">
            {messages.map((message) => (
              <button
                type="button"
                key={message.id}
                onClick={() => setSelectedId(message.id)}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${selectedId === message.id ? "border-emerald-400 bg-emerald-50/70" : "bg-card hover:bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{senderLabel(message)}</p><p className="mt-1 line-clamp-2 text-sm">{message.subject}</p></div>
                  <Badge variant="outline" className="shrink-0 bg-background text-[10px]">{TYPE_LABEL[message.classification.documentType]}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{formatDateTime(message.receivedAt)}</span><span>{STATUS_LABEL[message.status]}</span></div>
              </button>
            ))}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursorStack.length === 0}
                onClick={() => {
                  const previous = cursorStack.at(-1) || null;
                  setCursorStack((current) => current.slice(0, -1));
                  setCursor(previous);
                }}
              ><ArrowLeft className="mr-2 h-4 w-4" />Anterior</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!nextCursor}
                onClick={() => {
                  if (!nextCursor) return;
                  setCursorStack((current) => [...current, cursor ?? ""]);
                  setCursor(nextCursor);
                }}
              >Próxima<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </div>

          {selected ? (
            <Card className="h-fit overflow-hidden">
              <CardHeader className="border-b bg-muted/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><CardTitle className="text-lg">{selected.subject}</CardTitle><CardDescription className="mt-1 break-all">{selected.from}</CardDescription></div>
                  <Badge variant="outline" className="bg-background">{STATUS_LABEL[selected.status]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Tipo sugerido</p><p className="mt-1 text-sm font-semibold">{TYPE_LABEL[selected.classification.documentType]}</p></div>
                  <div><p className="text-xs text-muted-foreground">Competência</p><p className="mt-1 text-sm font-semibold">{formatCompetence(selected.classification.competence)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Vencimento</p><p className="mt-1 text-sm font-semibold">{formatDate(selected.classification.dueDate)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Valor encontrado</p><p className="mt-1 font-mono text-sm font-semibold">{formatAmount(selected.classification.amountCents)}</p></div>
                </div>

                <div className="rounded-xl border bg-muted/20 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conteúdo do e-mail</p>
                  <p className="max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-6">{selected.textContent || "O e-mail não possui conteúdo textual."}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold">Documentos arquivados</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.attachments.filter((attachment) => attachment.storagePath).map((attachment) => (
                      <Button key={attachment.id} variant="outline" size="sm" onClick={() => void openFile(selected, attachment.id)} disabled={working === `file:${attachment.id}`}>
                        {working === `file:${attachment.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}{attachment.filename}
                      </Button>
                    ))}
                    {selected.rawStoragePath ? <Button variant="ghost" size="sm" onClick={() => void openFile(selected, "raw")} disabled={working === "file:raw"}><Download className="mr-2 h-4 w-4" />E-mail original (.eml)</Button> : null}
                    {!selected.rawStoragePath && !selected.attachments.some((attachment) => attachment.storagePath) ? <p className="text-sm text-muted-foreground">Nenhum anexo foi arquivado.</p> : null}
                  </div>
                </div>

                {selected.classification.links.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold"><ExternalLink className="h-4 w-4" />Links enviados pelo fornecedor</div>
                    <p className="text-xs text-muted-foreground">Links externos não são baixados automaticamente. Confira o domínio antes de abrir.</p>
                    <div className="grid gap-2">
                      {selected.classification.links.map((link) => (
                        <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="truncate rounded-lg border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">{link}</a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selected.archiveWarnings.length > 0 ? (
                  <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{selected.archiveWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <Button asChild variant="outline"><Link href={FINANCIAL_ROUTES.expenses}>Consultar provisionamentos</Link></Button>
                  <div className="flex flex-wrap gap-2">
                    {permissions.financial?.expenses?.create ? <Button asChild><Link href={FINANCIAL_ROUTES.newExpense}>Registrar despesa</Link></Button> : null}
                    {canReview && selected.status === "ignored" ? (
                      <Button variant="outline" onClick={() => void review(selected, "pending_review")} disabled={working === `review:${selected.id}`}><RotateCcw className="mr-2 h-4 w-4" />Reabrir</Button>
                    ) : canReview ? (
                      <Button variant="outline" onClick={() => void review(selected, "ignored")} disabled={working === `review:${selected.id}`}><XCircle className="mr-2 h-4 w-4" />Ignorar</Button>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
