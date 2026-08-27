"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUpRight, CheckCircle2, ExternalLink, Loader2, MapPin, PackageSearch, PenLine, RotateCcw, Shirt } from "lucide-react";

import {
  deliverUniform,
  exchangeUniform,
  fetchUniformOverview,
  returnUniform,
  type UniformOverview,
} from "@/features/uniforms/client";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { SignatureCaptureModal } from "@/components/forms/signature-capture-modal";
import { UniformInstructionsDialog, hasUniformCareInstructions } from "@/components/uniform-instructions-dialog";
import type {
  UniformAssignment,
  UniformReturnedCondition,
  UniformStockDisposition,
  User,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const EMPTY_OVERVIEW: UniformOverview = { lots: [], assignments: [], events: [] };

function formatDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function conditionLabel(value?: string) {
  if (value === "novo") return "Novo";
  if (value === "usado") return "Usado";
  if (value === "bom_estado") return "Bom estado";
  if (value === "danificado") return "Danificado";
  if (value === "inutilizavel") return "Inutilizável";
  return value || "-";
}

function uniformDetails(item: { apparelType?: string | null; apparelColor?: string | null; apparelSize?: string | null }) {
  return [item.apparelType, item.apparelColor, item.apparelSize ? `Tam. ${item.apparelSize}` : null]
    .filter(Boolean)
    .join(" · ");
}

type SignatureRole = "collaborator" | "responsible";
type SignatureOperation = "delivery" | "exchange" | "return";
type CapturedSignatures = { collaborator: string; responsible: string };
const EMPTY_SIGNATURES: CapturedSignatures = { collaborator: "", responsible: "" };

function SignaturePanel({
  signatures,
  onCapture,
}: {
  signatures: CapturedSignatures;
  onCapture: (role: SignatureRole) => void;
}) {
  return (
    <div className="rounded-2xl border bg-slate-50 p-3">
      <p className="text-xs font-black uppercase text-slate-500">Assinaturas do termo</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">
        O PDF final será gerado e arquivado após as duas assinaturas.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onClick={() => onCapture("collaborator")}>
          {signatures.collaborator ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" /> : <PenLine className="mr-2 h-4 w-4" />}
          {signatures.collaborator ? "Colaborador assinou" : "Assinatura do colaborador"}
        </Button>
        <Button type="button" variant="outline" onClick={() => onCapture("responsible")}>
          {signatures.responsible ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" /> : <PenLine className="mr-2 h-4 w-4" />}
          {signatures.responsible ? "Responsável assinou" : "Assinatura do responsável"}
        </Button>
      </div>
    </div>
  );
}

function ItemPhoto({ item }: { item: { imageUrl?: string | null; productName?: string | null } }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt={item.productName ?? "Uniforme"}
        className="h-12 w-12 rounded-xl border bg-white object-cover"
        loading="lazy"
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-white text-amber-700">
      <Shirt className="h-5 w-5" />
    </div>
  );
}

export function CollaboratorUniforms({
  collaborator,
  mode = "default",
  onPossessionChange,
}: {
  collaborator: Pick<User, "id" | "username" | "email">;
  mode?: "default" | "return-only";
  onPossessionChange?: (piecesInPossession: number) => void;
}) {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [overview, setOverview] = useState<UniformOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<UniformAssignment | null>(null);
  const [instructionsTarget, setInstructionsTarget] = useState<UniformAssignment | null>(null);

  const [deliveryLotId, setDeliveryLotId] = useState("");
  const [deliveryQuantity, setDeliveryQuantity] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryTransactionId, setDeliveryTransactionId] = useState("");
  const [deliverySignatures, setDeliverySignatures] = useState<CapturedSignatures>(EMPTY_SIGNATURES);

  const [returnQuantity, setReturnQuantity] = useState(1);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnedCondition, setReturnedCondition] = useState<UniformReturnedCondition>("usado");
  const [stockDisposition, setStockDisposition] = useState<UniformStockDisposition>("retorna_estoque");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnTransactionId, setReturnTransactionId] = useState("");
  const [returnSignatures, setReturnSignatures] = useState<CapturedSignatures>(EMPTY_SIGNATURES);

  const [exchangeTarget, setExchangeTarget] = useState<UniformAssignment | null>(null);
  const [exchangeLotId, setExchangeLotId] = useState("");
  const [exchangeQuantity, setExchangeQuantity] = useState(1);
  const [exchangeDate, setExchangeDate] = useState(new Date().toISOString().slice(0, 10));
  const [exchangeReturnedCondition, setExchangeReturnedCondition] = useState<UniformReturnedCondition>("usado");
  const [exchangeStockDisposition, setExchangeStockDisposition] = useState<UniformStockDisposition>("retorna_estoque");
  const [exchangeNotes, setExchangeNotes] = useState("");
  const [exchangeTransactionId, setExchangeTransactionId] = useState("");
  const [exchangeSignatures, setExchangeSignatures] = useState<CapturedSignatures>(EMPTY_SIGNATURES);
  const [signatureTarget, setSignatureTarget] = useState<{ operation: SignatureOperation; role: SignatureRole } | null>(null);
  const onPossessionChangeRef = useRef(onPossessionChange);

  useEffect(() => {
    onPossessionChangeRef.current = onPossessionChange;
  }, [onPossessionChange]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const nextOverview = await fetchUniformOverview(firebaseUser, collaborator.id);
      setOverview(nextOverview);
      onPossessionChangeRef.current?.(
        nextOverview.assignments.reduce(
          (total, assignment) => total + Math.max(0, Number(assignment.quantityInPossession ?? 0)),
          0,
        ),
      );
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao carregar uniformes",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [collaborator.id, firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableLots = useMemo(
    () => overview.lots
      .filter((lot) => lot.quantity > 0 && (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .sort((left, right) => left.productName.localeCompare(right.productName, "pt-BR")),
    [overview.lots],
  );
  const possession = useMemo(
    () => overview.assignments.filter((assignment) => assignment.quantityInPossession > 0),
    [overview.assignments],
  );
  const selectedDeliveryLot = useMemo(
    () => availableLots.find((lot) => lot.id === deliveryLotId) ?? null,
    [availableLots, deliveryLotId],
  );
  const selectedExchangeLot = useMemo(
    () => availableLots.find((lot) => lot.id === exchangeLotId) ?? null,
    [availableLots, exchangeLotId],
  );
  const stockDiagnostics = useMemo(() => {
    const lotsWithQuantity = overview.lots.filter((lot) => Number(lot.quantity ?? 0) > 0);
    const blockedLots = lotsWithQuantity.filter((lot) => (lot.uniformStockStatus ?? "disponivel") !== "disponivel");
    return {
      totalLots: overview.lots.length,
      lotsWithQuantity: lotsWithQuantity.length,
      blockedLots: blockedLots.length,
    };
  }, [overview.lots]);

  const canDeliver = permissions.stock.uniforms?.deliver === true;
  const canReturn = permissions.stock.uniforms?.return === true;
  const canOpenUniformStock = permissions.stock.uniforms?.view === true;
  const collaboratorName = collaborator.username || collaborator.email || "Colaborador";
  const returnRequiresDiscard = returnedCondition === "danificado" || returnedCondition === "inutilizavel";
  const exchangeRequiresDiscard = exchangeReturnedCondition === "danificado" || exchangeReturnedCondition === "inutilizavel";

  const openSignedTerm = async (transactionId: string) => {
    if (!firebaseUser) return;
    const response = await fetch(`/api/uniforms/terms/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
      cache: "no-store",
    });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const closeReturnDialog = () => {
    setReturnTarget(null);
    setReturnQuantity(1);
    setReturnNotes("");
    setReturnedCondition("usado");
    setStockDisposition("retorna_estoque");
    setReturnTransactionId("");
    setReturnSignatures(EMPTY_SIGNATURES);
  };

  const closeExchangeDialog = () => {
    setExchangeTarget(null);
    setExchangeLotId("");
    setExchangeQuantity(1);
    setExchangeDate(new Date().toISOString().slice(0, 10));
    setExchangeReturnedCondition("usado");
    setExchangeStockDisposition("retorna_estoque");
    setExchangeNotes("");
    setExchangeTransactionId("");
    setExchangeSignatures(EMPTY_SIGNATURES);
  };

  const submitDelivery = async () => {
    if (!firebaseUser || !deliveryLotId) return;
    if (!deliverySignatures.collaborator || !deliverySignatures.responsible) return;
    setSaving(true);
    try {
      const result = await deliverUniform(firebaseUser, {
        lotId: deliveryLotId,
        collaboratorUserId: collaborator.id,
        quantity: deliveryQuantity,
        occurredAt: deliveryDate,
        notes: deliveryNotes || undefined,
        transactionId: deliveryTransactionId,
        collaboratorSignature: deliverySignatures.collaborator,
        responsibleSignature: deliverySignatures.responsible,
      });
      setDeliveryOpen(false);
      setDeliveryLotId("");
      setDeliveryQuantity(1);
      setDeliveryNotes("");
      setDeliveryTransactionId("");
      setDeliverySignatures(EMPTY_SIGNATURES);
      await load();
      toast({ title: "Entrega registrada com termo assinado." });
      void openSignedTerm(result.transaction.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha na entrega",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  const submitReturn = async () => {
    if (!firebaseUser || !returnTarget) return;
    if (!returnSignatures.collaborator || !returnSignatures.responsible) return;
    setSaving(true);
    try {
      const result = await returnUniform(firebaseUser, {
        assignmentId: returnTarget.id,
        quantity: returnQuantity,
        occurredAt: returnDate,
        returnedCondition,
        stockDisposition,
        notes: returnNotes || undefined,
        transactionId: returnTransactionId,
        collaboratorSignature: returnSignatures.collaborator,
        responsibleSignature: returnSignatures.responsible,
      });
      closeReturnDialog();
      await load();
      toast({ title: "Devolução registrada com termo assinado." });
      void openSignedTerm(result.transaction.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha na devolução",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  const submitExchange = async () => {
    if (!firebaseUser || !exchangeTarget || !exchangeLotId) return;
    if (!exchangeSignatures.collaborator || !exchangeSignatures.responsible) return;
    setSaving(true);
    try {
      const result = await exchangeUniform(firebaseUser, {
        assignmentId: exchangeTarget.id,
        newLotId: exchangeLotId,
        quantity: exchangeQuantity,
        occurredAt: exchangeDate,
        returnedCondition: exchangeReturnedCondition,
        stockDisposition: exchangeStockDisposition,
        notes: exchangeNotes || undefined,
        transactionId: exchangeTransactionId,
        collaboratorSignature: exchangeSignatures.collaborator,
        responsibleSignature: exchangeSignatures.responsible,
      });
      closeExchangeDialog();
      await load();
      toast({ title: "Troca registrada em termo único." });
      void openSignedTerm(result.transaction.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha na troca",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando uniformes...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase text-slate-500">Em posse</p>
          <p className="text-sm font-semibold text-slate-600">
            {possession.reduce((sum, item) => sum + item.quantityInPossession, 0)} peça(s)
          </p>
        </div>
        {canDeliver && mode === "default" ? (
          <Button
            size="sm"
            onClick={() => {
              setDeliveryTransactionId(crypto.randomUUID());
              setDeliverySignatures(EMPTY_SIGNATURES);
              setDeliveryOpen(true);
            }}
          >
            <Shirt className="mr-2 h-4 w-4" /> Entregar uniforme
          </Button>
        ) : null}
      </div>

      {possession.length === 0 ? (
        <p className="rounded-2xl bg-[#eee5d1] p-4 text-sm font-semibold text-[#817762]">
          Nenhum uniforme em posse deste colaborador.
        </p>
      ) : (
        <div className="space-y-2">
          {possession.map((assignment) => (
            <div
              key={assignment.id}
              role="button"
              tabIndex={0}
              className="rounded-2xl border border-amber-100 bg-[#fffaf0] p-3 text-left transition hover:border-[#df2f78]/40 hover:bg-[#fff7e8]"
              onClick={() => setInstructionsTarget(assignment)}
              onKeyDown={(event) => {
                if (event.currentTarget !== event.target) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setInstructionsTarget(assignment);
                }
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <ItemPhoto item={assignment} />
                  <div>
                    <p className="text-xs font-black text-[#25231f]">{assignment.productName}</p>
                    {uniformDetails(assignment) ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-700">{uniformDetails(assignment)}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="secondary">{conditionLabel(assignment.issuedCondition)}</Badge>
                      <Badge variant="outline">{assignment.quantityInPossession} em posse</Badge>
                      <Badge variant="outline">Entregue em {formatDate(assignment.deliveredAt)}</Badge>
                      {hasUniformCareInstructions(assignment) ? (
                        <Badge variant="outline" className="border-[#df2f78]/30 bg-white text-[#df2f78]">Instruções</Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canDeliver && canReturn && mode === "default" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setExchangeTarget(assignment);
                        setExchangeLotId("");
                        setExchangeQuantity(1);
                        setExchangeDate(new Date().toISOString().slice(0, 10));
                        setExchangeReturnedCondition("usado");
                        setExchangeStockDisposition("retorna_estoque");
                        setExchangeNotes("");
                        setExchangeTransactionId(crypto.randomUUID());
                        setExchangeSignatures(EMPTY_SIGNATURES);
                      }}
                    >
                      <ArrowLeftRight className="mr-2 h-4 w-4" /> Trocar
                    </Button>
                  ) : null}
                  {canReturn ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setReturnTarget(assignment);
                        setReturnQuantity(1);
                        setReturnDate(new Date().toISOString().slice(0, 10));
                        setReturnedCondition("usado");
                        setStockDisposition("retorna_estoque");
                        setReturnNotes("");
                        setReturnTransactionId(crypto.randomUUID());
                        setReturnSignatures(EMPTY_SIGNATURES);
                      }}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" /> Devolver
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-slate-50 p-3">
        <div>
          <p className="text-xs font-black uppercase text-slate-500">Histórico</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            {overview.events.length === 0
              ? "Nenhuma movimentação registrada."
              : `${overview.events.length} movimentação${overview.events.length === 1 ? "" : "ões"} registrada${overview.events.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
          Ver histórico
        </Button>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex max-h-[82vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Histórico de uniformes</DialogTitle>
            <DialogDescription>
              Entregas, trocas e devoluções registradas para {collaborator.username}.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {overview.events.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                Nenhuma movimentação registrada.
              </p>
            ) : (
              <div className="space-y-2">
                {overview.events.map((event) => (
                  <div key={event.id} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 gap-3">
                        <ItemPhoto item={event} />
                        <div>
                          <p className="text-xs font-black">{event.productName}</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">
                            {event.eventType === "UNIFORME_ENTREGA" ? "Entrega" : event.eventType === "UNIFORME_TROCA" ? "Troca" : "Devolução"} · {event.quantity} un · {formatDate(event.occurredAt)}
                          </p>
                          {event.eventType === "UNIFORME_TROCA" && event.exchangedFromProductName ? (
                            <p className="mt-1 text-[11px] font-semibold text-slate-500">
                              {event.exchangedFromProductName} → {event.productName}
                            </p>
                          ) : null}
                          {uniformDetails(event) ? (
                            <p className="mt-1 text-[11px] font-semibold text-slate-400">{uniformDetails(event)}</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {event.issuedCondition ? <Badge variant="secondary">{conditionLabel(event.issuedCondition)}</Badge> : null}
                        {event.returnedCondition ? <Badge variant="outline">{conditionLabel(event.returnedCondition)}</Badge> : null}
                        {event.uniformTransactionId ? (
                          <Button size="sm" variant="outline" onClick={() => void openSignedTerm(event.uniformTransactionId!)}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" /> Termo
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deliveryOpen}
        onOpenChange={(open) => {
          setDeliveryOpen(open);
          if (!open) {
            setDeliveryTransactionId("");
            setDeliverySignatures(EMPTY_SIGNATURES);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Entregar uniforme</DialogTitle>
            <DialogDescription>Retira a peça do estoque de uniformes e vincula a {collaborator.username}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Peças disponíveis</Label>
              {availableLots.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-5">
                  <div className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
                      <PackageSearch className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-base font-black text-slate-900">Nenhuma peça disponível para entrega.</p>
                      <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-500">
                        Os cards aparecem aqui quando existir lote no estoque próprio de uniformes com quantidade maior que zero e status disponível.
                      </p>
                      <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-xs font-bold text-slate-500">
                        {stockDiagnostics.totalLots === 0 ? (
                          <span>Nenhum lote foi encontrado no estoque de uniformes.</span>
                        ) : stockDiagnostics.lotsWithQuantity === 0 ? (
                          <span>Existem {stockDiagnostics.totalLots} lote(s), mas todos estão com quantidade zerada.</span>
                        ) : stockDiagnostics.blockedLots > 0 ? (
                          <span>
                            Existem {stockDiagnostics.lotsWithQuantity} lote(s) com saldo, mas {stockDiagnostics.blockedLots} não estão com status disponível.
                          </span>
                        ) : (
                          <span>Nenhum lote elegível foi encontrado para esta entrega.</span>
                        )}
                      </div>
                      {canOpenUniformStock ? (
                        <Button asChild variant="outline" size="sm" className="mt-4">
                          <Link href="/dashboard/stock/uniforms">
                            Abrir estoque de uniformes
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid max-h-[360px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                  {availableLots.map((lot) => {
                    const selected = deliveryLotId === lot.id;
                    const details = [
                      lot.apparelType,
                      lot.apparelColor,
                      lot.apparelSize ? `Tam. ${lot.apparelSize}` : null,
                    ].filter(Boolean);

                    return (
                      <button
                        key={lot.id}
                        type="button"
                        onClick={() => {
                          setDeliveryLotId(lot.id);
                          setDeliverySignatures(EMPTY_SIGNATURES);
                        }}
                        className={`rounded-2xl border p-3 text-left transition ${
                          selected
                            ? "border-[#df2f78] bg-[#fff0f6] shadow-sm ring-2 ring-[#df2f78]/15"
                            : "border-slate-200 bg-white hover:border-[#df2f78]/40 hover:bg-[#fff8fb]"
                        }`}
                      >
                        <div className="flex gap-3">
                          <ItemPhoto item={lot} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-sm font-black text-slate-900">{lot.productName}</p>
                              {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[#df2f78]" /> : null}
                            </div>
                            {details.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {details.map((detail) => (
                                  <span key={detail} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">
                                    {detail}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs font-semibold text-slate-400">Sem variação cadastrada.</p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs font-bold text-slate-500">
                          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                            <span>Estoque disponível</span>
                            <span className="font-black text-slate-900">{lot.quantity} un</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{conditionLabel(lot.condition)}</Badge>
                            {lot.locationName ? (
                              <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 font-black text-slate-500">
                                <MapPin className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{lot.locationName}</span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {availableLots.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Quantidade</Label>
                    <Input
                      type="number"
                      min={1}
                      max={selectedDeliveryLot?.quantity ?? undefined}
                      step={1}
                      value={deliveryQuantity}
                      onChange={(event) => {
                        setDeliveryQuantity(Number(event.target.value));
                        setDeliverySignatures(EMPTY_SIGNATURES);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Data</Label>
                    <Input
                      type="date"
                      value={deliveryDate}
                      onChange={(event) => {
                        setDeliveryDate(event.target.value);
                        setDeliverySignatures(EMPTY_SIGNATURES);
                      }}
                    />
                  </div>
                </div>
                {selectedDeliveryLot && deliveryQuantity > selectedDeliveryLot.quantity ? (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                    A quantidade informada supera o estoque disponível desta peça.
                  </p>
                ) : null}
                <div className="space-y-2">
                  <Label>Observação</Label>
                  <Textarea
                    value={deliveryNotes}
                    onChange={(event) => {
                      setDeliveryNotes(event.target.value);
                      setDeliverySignatures(EMPTY_SIGNATURES);
                    }}
                  />
                </div>
              </>
            ) : null}
            {selectedDeliveryLot ? (
              <SignaturePanel
                signatures={deliverySignatures}
                onCapture={(role) => setSignatureTarget({ operation: "delivery", role })}
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveryOpen(false)}>
              {availableLots.length === 0 ? "Fechar" : "Cancelar"}
            </Button>
            {availableLots.length > 0 ? (
              <Button
                onClick={submitDelivery}
                disabled={
                  saving
                  || !deliveryLotId
                  || !deliveryTransactionId
                  || !deliverySignatures.collaborator
                  || !deliverySignatures.responsible
                  || deliveryQuantity <= 0
                  || Boolean(selectedDeliveryLot && deliveryQuantity > selectedDeliveryLot.quantity)
                }
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirmar entrega
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!returnTarget} onOpenChange={(open) => !open && closeReturnDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar devolução</DialogTitle>
            <DialogDescription>{returnTarget?.productName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  max={returnTarget?.quantityInPossession ?? 1}
                  step={1}
                  value={returnQuantity}
                  onChange={(event) => {
                    setReturnQuantity(Number(event.target.value));
                    setReturnSignatures(EMPTY_SIGNATURES);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={returnDate}
                  onChange={(event) => {
                    setReturnDate(event.target.value);
                    setReturnSignatures(EMPTY_SIGNATURES);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Estado devolvido</Label>
              <Select
                value={returnedCondition}
                onValueChange={(value) => {
                  const condition = value as UniformReturnedCondition;
                  setReturnedCondition(condition);
                  setReturnSignatures(EMPTY_SIGNATURES);
                  if (
                    (condition === "danificado" || condition === "inutilizavel") &&
                    stockDisposition === "retorna_estoque"
                  ) {
                    setStockDisposition("descartar");
                  }
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bom_estado">Bom estado</SelectItem>
                  <SelectItem value="usado">Usado</SelectItem>
                  <SelectItem value="danificado">Danificado</SelectItem>
                  <SelectItem value="inutilizavel">Inutilizável</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ressalvas da avaliação</Label>
              <Textarea
                value={returnNotes}
                onChange={(event) => {
                  setReturnNotes(event.target.value);
                  setReturnSignatures(EMPTY_SIGNATURES);
                }}
                placeholder="Ex: peça sem avaria, elástico cedido, mancha, rasgo, descarte autorizado..."
              />
            </div>
            <div className="space-y-2">
              <Label>Destino da peça</Label>
              <Select
                value={stockDisposition}
                onValueChange={(value) => {
                  setStockDisposition(value as UniformStockDisposition);
                  setReturnSignatures(EMPTY_SIGNATURES);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retorna_estoque" disabled={returnRequiresDiscard}>Retornar ao estoque como usado</SelectItem>
                  <SelectItem value="descartar">Descartar</SelectItem>
                </SelectContent>
              </Select>
              {returnRequiresDiscard ? (
                <p className="text-xs font-semibold text-amber-700">Peças danificadas ou inutilizáveis devem ser descartadas.</p>
              ) : null}
            </div>
            <SignaturePanel
              signatures={returnSignatures}
              onCapture={(role) => setSignatureTarget({ operation: "return", role })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReturnDialog}>Cancelar</Button>
            <Button
              onClick={submitReturn}
              disabled={
                saving ||
                !returnTransactionId ||
                !returnSignatures.collaborator ||
                !returnSignatures.responsible ||
                returnQuantity <= 0 ||
                returnQuantity > (returnTarget?.quantityInPossession ?? 0)
              }
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirmar devolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!exchangeTarget} onOpenChange={(open) => !open && closeExchangeDialog()}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trocar uniforme</DialogTitle>
            <DialogDescription>
              A devolução e a nova entrega serão registradas juntas em um único termo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs font-black uppercase text-amber-700">Peça devolvida</p>
              <p className="mt-1 text-sm font-black">{exchangeTarget?.productName}</p>
              <p className="mt-1 text-xs font-semibold text-amber-700">{exchangeTarget ? uniformDetails(exchangeTarget) : null}</p>
            </div>
            <div className="space-y-2">
              <Label>Nova peça</Label>
              <Select
                value={exchangeLotId}
                onValueChange={(value) => {
                  setExchangeLotId(value);
                  setExchangeSignatures(EMPTY_SIGNATURES);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione a peça que será entregue" /></SelectTrigger>
                <SelectContent>
                  {availableLots.map((lot) => (
                    <SelectItem key={lot.id} value={lot.id}>
                      {lot.productName} · {uniformDetails(lot) || "sem variação"} · {lot.quantity} un
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  max={Math.min(exchangeTarget?.quantityInPossession ?? 1, selectedExchangeLot?.quantity ?? 1)}
                  value={exchangeQuantity}
                  onChange={(event) => {
                    setExchangeQuantity(Number(event.target.value));
                    setExchangeSignatures(EMPTY_SIGNATURES);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={exchangeDate}
                  onChange={(event) => {
                    setExchangeDate(event.target.value);
                    setExchangeSignatures(EMPTY_SIGNATURES);
                  }}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Condição da peça devolvida</Label>
                <Select
                  value={exchangeReturnedCondition}
                  onValueChange={(value) => {
                    const condition = value as UniformReturnedCondition;
                    setExchangeReturnedCondition(condition);
                    setExchangeSignatures(EMPTY_SIGNATURES);
                    if (
                      (condition === "danificado" || condition === "inutilizavel") &&
                      exchangeStockDisposition === "retorna_estoque"
                    ) {
                      setExchangeStockDisposition("descartar");
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bom_estado">Bom estado</SelectItem>
                    <SelectItem value="usado">Usado</SelectItem>
                    <SelectItem value="danificado">Danificado</SelectItem>
                    <SelectItem value="inutilizavel">Inutilizável</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Destino da peça devolvida</Label>
                <Select
                  value={exchangeStockDisposition}
                  onValueChange={(value) => {
                    setExchangeStockDisposition(value as UniformStockDisposition);
                    setExchangeSignatures(EMPTY_SIGNATURES);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retorna_estoque" disabled={exchangeRequiresDiscard}>Retornar ao estoque como usado</SelectItem>
                    <SelectItem value="descartar">Descartar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Motivo e ressalvas da troca</Label>
              <Textarea
                value={exchangeNotes}
                onChange={(event) => {
                  setExchangeNotes(event.target.value);
                  setExchangeSignatures(EMPTY_SIGNATURES);
                }}
                placeholder="Ex.: ajuste de tamanho, desgaste, troca de função..."
              />
            </div>
            <SignaturePanel
              signatures={exchangeSignatures}
              onCapture={(role) => setSignatureTarget({ operation: "exchange", role })}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeExchangeDialog}>Cancelar</Button>
            <Button
              onClick={submitExchange}
              disabled={
                saving ||
                !exchangeLotId ||
                !exchangeTransactionId ||
                !exchangeSignatures.collaborator ||
                !exchangeSignatures.responsible ||
                exchangeQuantity <= 0 ||
                exchangeQuantity > (exchangeTarget?.quantityInPossession ?? 0) ||
                exchangeQuantity > (selectedExchangeLot?.quantity ?? 0)
              }
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowLeftRight className="mr-2 h-4 w-4" />}
              Confirmar troca
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignatureCaptureModal
        open={!!signatureTarget}
        title={signatureTarget?.role === "collaborator" ? "Assinatura do colaborador" : "Assinatura do responsável"}
        description="A assinatura será incorporada ao termo final da movimentação de uniforme."
        onOpenChange={(open) => { if (!open) setSignatureTarget(null); }}
        onSignatureCaptured={(dataUrl) => {
          if (!signatureTarget) return;
          const update = (current: CapturedSignatures) => ({ ...current, [signatureTarget.role]: dataUrl });
          if (signatureTarget.operation === "delivery") setDeliverySignatures(update);
          if (signatureTarget.operation === "return") setReturnSignatures(update);
          if (signatureTarget.operation === "exchange") setExchangeSignatures(update);
        }}
      />

      <UniformInstructionsDialog
        item={instructionsTarget}
        open={!!instructionsTarget}
        onOpenChange={(open) => { if (!open) setInstructionsTarget(null); }}
      />
    </div>
  );
}
