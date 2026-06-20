"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, RotateCcw, Shirt } from "lucide-react";

import {
  deliverUniform,
  fetchUniformOverview,
  returnUniform,
  type UniformOverview,
} from "@/features/uniforms/client";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  UniformDeliveryTermDocument,
  UniformReturnTermDocument,
} from "@/components/pdf/UniformTermDocument";
import type {
  UniformAssignment,
  UniformReturnedCondition,
  UniformStockDisposition,
  User,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((mod) => mod.PDFDownloadLink),
  {
    ssr: false,
    loading: () => (
      <Button variant="outline" size="sm" disabled>
        Carregando PDF...
      </Button>
    ),
  },
);

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

function pdfSafeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
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

export function CollaboratorUniforms({ collaborator }: { collaborator: User }) {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [overview, setOverview] = useState<UniformOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<UniformAssignment | null>(null);

  const [deliveryLotId, setDeliveryLotId] = useState("");
  const [deliveryQuantity, setDeliveryQuantity] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryTermGenerated, setDeliveryTermGenerated] = useState(false);

  const [returnQuantity, setReturnQuantity] = useState(1);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnedCondition, setReturnedCondition] = useState<UniformReturnedCondition>("usado");
  const [stockDisposition, setStockDisposition] = useState<UniformStockDisposition>("retorna_estoque");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnTermGenerated, setReturnTermGenerated] = useState(false);
  const [returnTermSigned, setReturnTermSigned] = useState(false);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setOverview(await fetchUniformOverview(firebaseUser, collaborator.id));
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

  const canDeliver = permissions.stock.uniforms?.deliver === true;
  const canReturn = permissions.stock.uniforms?.return === true;
  const collaboratorName = collaborator.username || collaborator.email || "Colaborador";
  const registeredByName = firebaseUser?.displayName || firebaseUser?.email || "Responsável/RH";
  const returnRequiresDiscard = returnedCondition === "danificado" || returnedCondition === "inutilizavel";
  const canGenerateReturnTerm = !!returnTarget &&
    returnQuantity > 0 &&
    returnQuantity <= returnTarget.quantityInPossession &&
    !!returnDate;

  const resetReturnTerm = () => {
    setReturnTermGenerated(false);
    setReturnTermSigned(false);
  };

  const closeReturnDialog = () => {
    setReturnTarget(null);
    setReturnQuantity(1);
    setReturnNotes("");
    setReturnedCondition("usado");
    setStockDisposition("retorna_estoque");
    resetReturnTerm();
  };

  const submitDelivery = async () => {
    if (!firebaseUser || !deliveryLotId) return;
    setSaving(true);
    try {
      await deliverUniform(firebaseUser, {
        lotId: deliveryLotId,
        collaboratorUserId: collaborator.id,
        quantity: deliveryQuantity,
        occurredAt: deliveryDate,
        notes: deliveryNotes || undefined,
      });
      setDeliveryOpen(false);
      setDeliveryLotId("");
      setDeliveryQuantity(1);
      setDeliveryNotes("");
      setDeliveryTermGenerated(false);
      await load();
      toast({ title: "Uniforme entregue e vinculado ao colaborador." });
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
    if (!returnTermGenerated || !returnTermSigned) {
      toast({
        variant: "destructive",
        title: "Termo de devolução pendente",
        description: "Gere o PDF, colete a assinatura e marque o termo como assinado antes de confirmar.",
      });
      return;
    }
    setSaving(true);
    try {
      await returnUniform(firebaseUser, {
        assignmentId: returnTarget.id,
        quantity: returnQuantity,
        occurredAt: returnDate,
        returnedCondition,
        stockDisposition,
        notes: returnNotes || undefined,
      });
      closeReturnDialog();
      await load();
      toast({ title: "Devolução registrada." });
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
        {canDeliver ? (
          <Button
            size="sm"
            onClick={() => {
              setDeliveryTermGenerated(false);
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
            <div key={assignment.id} className="rounded-2xl border border-amber-100 bg-[#fffaf0] p-3">
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
                    </div>
                  </div>
                </div>
                {canReturn ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReturnTarget(assignment);
                      setReturnQuantity(1);
                      setReturnDate(new Date().toISOString().slice(0, 10));
                      setReturnedCondition("usado");
                      setStockDisposition("retorna_estoque");
                      setReturnNotes("");
                      resetReturnTerm();
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Registrar devolução
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-black uppercase text-slate-500">Histórico</p>
        {overview.events.length === 0 ? (
          <p className="text-sm font-semibold text-slate-500">Nenhuma movimentação registrada.</p>
        ) : (
          <div className="space-y-2">
            {overview.events.slice(0, 12).map((event) => (
              <div key={event.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 gap-3">
                    <ItemPhoto item={event} />
                    <div>
                      <p className="text-xs font-black">{event.productName}</p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">
                        {event.eventType === "UNIFORME_ENTREGA" ? "Entrega" : "Devolução"} · {event.quantity} un · {formatDate(event.occurredAt)}
                      </p>
                      {uniformDetails(event) ? (
                        <p className="mt-1 text-[11px] font-semibold text-slate-400">{uniformDetails(event)}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {event.issuedCondition ? <Badge variant="secondary">{conditionLabel(event.issuedCondition)}</Badge> : null}
                    {event.returnedCondition ? <Badge variant="outline">{conditionLabel(event.returnedCondition)}</Badge> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={deliveryOpen}
        onOpenChange={(open) => {
          setDeliveryOpen(open);
          if (!open) setDeliveryTermGenerated(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entregar uniforme</DialogTitle>
            <DialogDescription>Retira a peça do estoque de uniformes e vincula a {collaborator.username}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Peça disponível</Label>
              <Select
                value={deliveryLotId}
                onValueChange={(value) => {
                  setDeliveryLotId(value);
                  setDeliveryTermGenerated(false);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione a peça..." /></SelectTrigger>
                <SelectContent>
                  {availableLots.map((lot) => (
                    <SelectItem key={lot.id} value={lot.id}>
                      {[lot.productName, uniformDetails(lot), conditionLabel(lot.condition), `${lot.quantity} un`]
                        .filter(Boolean)
                        .join(" · ")}
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
                  step={1}
                  value={deliveryQuantity}
                  onChange={(event) => {
                    setDeliveryQuantity(Number(event.target.value));
                    setDeliveryTermGenerated(false);
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
                    setDeliveryTermGenerated(false);
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea
                value={deliveryNotes}
                onChange={(event) => {
                  setDeliveryNotes(event.target.value);
                  setDeliveryTermGenerated(false);
                }}
              />
            </div>
            {selectedDeliveryLot ? (
              <div className="rounded-2xl border bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-500">Termo de entrega</p>
                    <p className="text-xs font-semibold text-slate-500">
                      Gere o PDF para coletar a assinatura do colaborador.
                    </p>
                  </div>
                  <PDFDownloadLink
                    document={(
                      <UniformDeliveryTermDocument
                        collaboratorName={collaboratorName}
                        registeredByName={registeredByName}
                        lot={selectedDeliveryLot}
                        quantity={deliveryQuantity}
                        deliveryDate={deliveryDate}
                        notes={deliveryNotes}
                      />
                    )}
                    fileName={`termo-entrega-uniforme-${pdfSafeName(collaboratorName)}-${deliveryDate}.pdf`}
                  >
                    {(({ loading }: any) => (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || deliveryQuantity <= 0}
                        onClick={() => setDeliveryTermGenerated(true)}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {loading ? "Gerando..." : "Baixar termo"}
                      </Button>
                    )) as any}
                  </PDFDownloadLink>
                </div>
                {deliveryTermGenerated ? (
                  <p className="mt-2 text-xs font-semibold text-emerald-700">
                    Termo gerado. A entrega pode ser confirmada após a assinatura física/digital.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveryOpen(false)}>Cancelar</Button>
            <Button onClick={submitDelivery} disabled={saving || !deliveryLotId || deliveryQuantity <= 0}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirmar entrega
            </Button>
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
                    resetReturnTerm();
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
                    resetReturnTerm();
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
                  resetReturnTerm();
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
                  resetReturnTerm();
                }}
                placeholder="Ex: peça sem avaria, elástico cedido, mancha, rasgo, descarte autorizado..."
              />
            </div>
            <div className="rounded-2xl border bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-slate-500">Termo de devolução</p>
                  <p className="text-xs font-semibold text-slate-500">
                    Gere o PDF com a avaliação para coletar a assinatura antes de definir o destino final.
                  </p>
                </div>
                {returnTarget ? (
                  <PDFDownloadLink
                    document={(
                      <UniformReturnTermDocument
                        collaboratorName={collaboratorName}
                        registeredByName={registeredByName}
                        assignment={returnTarget}
                        quantity={returnQuantity}
                        returnDate={returnDate}
                        returnedCondition={returnedCondition}
                        notes={returnNotes}
                      />
                    )}
                    fileName={`termo-devolucao-uniforme-${pdfSafeName(collaboratorName)}-${returnDate}.pdf`}
                  >
                    {(({ loading }: any) => (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || !canGenerateReturnTerm}
                        onClick={() => setReturnTermGenerated(true)}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {loading ? "Gerando..." : "Baixar termo"}
                      </Button>
                    )) as any}
                  </PDFDownloadLink>
                ) : null}
              </div>
            </div>
            {returnTermGenerated ? (
              <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                <div className="space-y-2">
                  <Label>Destino final após assinatura</Label>
                  <Select value={stockDisposition} onValueChange={(value) => setStockDisposition(value as UniformStockDisposition)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retorna_estoque" disabled={returnRequiresDiscard}>
                        Retornar ao estoque como usado
                      </SelectItem>
                      <SelectItem value="descartar">Descartar</SelectItem>
                    </SelectContent>
                  </Select>
                  {returnRequiresDiscard ? (
                    <p className="text-xs font-semibold text-amber-700">
                      Peças danificadas ou inutilizáveis devem ser descartadas.
                    </p>
                  ) : null}
                </div>
                <label className="flex items-start gap-2 text-xs font-semibold text-slate-700">
                  <Checkbox
                    checked={returnTermSigned}
                    onCheckedChange={(checked) => setReturnTermSigned(checked === true)}
                  />
                  <span>O termo foi assinado/conferido e o destino final já pode ser registrado.</span>
                </label>
              </div>
            ) : (
              <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                Após baixar o termo para assinatura, o sistema libera a decisão final: retornar ao estoque como usado ou descartar.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReturnDialog}>Cancelar</Button>
            <Button
              onClick={submitReturn}
              disabled={
                saving ||
                !returnTermGenerated ||
                !returnTermSigned ||
                returnQuantity <= 0 ||
                returnQuantity > (returnTarget?.quantityInPossession ?? 0)
              }
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Confirmar devolução
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
