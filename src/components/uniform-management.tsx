"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Loader2,
  PackagePlus,
  Pencil,
  Recycle,
  Search,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import { adjustUniformLot, fetchUniformOverview, type UniformOverview } from "@/features/uniforms/client";
import { useAuth } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-products";
import { useToast } from "@/hooks/use-toast";
import {
  type LotEntry,
  type Product,
  type UniformAssignment,
  type UniformCondition,
  type UniformEvent,
  type UniformStockStatus,
} from "@/types";
import { cn } from "@/lib/utils";
import { AddEditProductModal } from "@/components/add-edit-product-modal";
import { UniformInstructionsDialog, hasUniformCareInstructions } from "@/components/uniform-instructions-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EMPTY_OVERVIEW: UniformOverview = { lots: [], assignments: [], events: [] };

type UniformTab = "stock" | "possession" | "history";
type ConditionFilter = UniformCondition | "all";
type StockStatusFilter = UniformStockStatus | "all";

const numberFormatter = new Intl.NumberFormat("pt-BR");

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function matchesSearch(query: string, values: Array<string | number | null | undefined>) {
  if (!query) return true;
  return values.some((value) => normalizeText(String(value ?? "")).includes(query));
}

function conditionLabel(value?: string | null) {
  return value === "novo" ? "Novo" : value === "usado" ? "Usado" : value || "-";
}

function stockStatusLabel(value?: string | null) {
  return (value ?? "disponivel") === "disponivel" ? "Disponível" : "Em avaliação";
}

function eventLabel(value: string) {
  const event = value.replace("UNIFORME_", "");
  const labels: Record<string, string> = {
    ENTREGA: "Entrega",
    TROCA: "Troca",
    DEVOLUCAO: "Devolução",
    PERDA: "Perda",
    DANO: "Dano",
    DESCARTE: "Descarte",
    COBRANCA: "Cobrança",
  };
  return labels[event] ?? event.replaceAll("_", " ").toLowerCase();
}

function sizeLabel(value?: string | null) {
  const text = String(value ?? "").trim();
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized === "unico" || normalized === "tamanho unico") return "ÚNICO";
  return text || "Sem tamanho";
}

function lotLabel(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase().replace(/[_-]/g, " ") === "sem lote") return "Sem lote";
  return text;
}

function uniformDetails(item: { apparelType?: string | null; apparelColor?: string | null }) {
  return [item.apparelType, item.apparelColor].filter(Boolean).join(" · ");
}

function formatQuantity(value: number) {
  return numberFormatter.format(value);
}

function formatPercent(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function initials(name?: string | null) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "U";
  return `${parts[0]?.[0] ?? ""}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""}`.toUpperCase();
}

function avatarTone(seed?: string | null) {
  const tones = [
    "bg-[#e8327c] text-white",
    "bg-[#625df5] text-white",
    "bg-[#a58bff] text-white",
    "bg-[#8ee7ee] text-[#176b75]",
    "bg-[#fffaa5] text-[#8b7b00]",
    "bg-[#ffe8f2] text-[#d9275f]",
  ];
  const text = String(seed ?? "");
  const total = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function ItemPhoto({ item }: { item: { imageUrl?: string | null; productName?: string | null } }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt={item.productName ?? "Uniforme"}
        className="h-12 w-12 rounded-2xl border border-[#e4e4ea] bg-[#f7f7f9] object-cover"
        loading="lazy"
      />
    );
  }

  return (
    <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[#e4e4ea] bg-[#f7f7f9] text-[#9c9ca8]">
      <Shirt className="h-6 w-6" />
    </div>
  );
}

function CollaboratorAvatar({ name }: { name: string }) {
  return (
    <div className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-full text-base font-black", avatarTone(name))}>
      {initials(name)}
    </div>
  );
}

function Pill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={cn("inline-flex w-fit items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-black", className)}>
      {children}
    </span>
  );
}

function ConditionPill({ value }: { value?: string | null }) {
  const isNew = value === "novo";
  return (
    <Pill className={isNew ? "bg-[#e8fbf1] text-[#009b6d]" : "bg-[#fff7e7] text-[#d87600]"}>
      {conditionLabel(value)}
    </Pill>
  );
}

function StatusPill({ value }: { value?: string | null }) {
  const available = (value ?? "disponivel") === "disponivel";
  return (
    <Pill className={available ? "bg-[#ebf7ff] text-[#008bd6]" : "bg-[#edf0f4] text-[#6f8198]"}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {stockStatusLabel(value)}
    </Pill>
  );
}

function MovementPill({ type }: { type: string }) {
  const event = type.replace("UNIFORME_", "");
  const tone =
    event === "ENTREGA" ? "bg-[#e8fbf1] text-[#009b6d]" :
    event === "DEVOLUCAO" ? "bg-[#fff7e7] text-[#d87600]" :
    event === "TROCA" ? "bg-[#eef7ff] text-[#008bd6]" :
    "bg-[#ffecef] text-[#d9275f]";
  const Icon =
    event === "ENTREGA" ? ArrowDownLeft :
    event === "DEVOLUCAO" ? ArrowUpRight :
    event === "TROCA" ? Recycle :
    PackagePlus;

  return (
    <Pill className={tone}>
      <Icon className="h-4 w-4" />
      {eventLabel(type)}
    </Pill>
  );
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  description: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <div className="flex min-h-[112px] items-center gap-4 rounded-[24px] border border-[#dfdfe7] bg-white px-5 py-4 shadow-[0_8px_22px_rgba(21,21,29,0.07)]">
      <div className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-2xl", tone)}>
        <Icon className="h-7 w-7" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-3xl font-black leading-none text-[#171820]">{formatQuantity(value)}</p>
          <p className="max-w-[150px] truncate text-sm font-black uppercase text-[#9c9ca8]">{label}</p>
        </div>
        <p className="mt-2 truncate text-base font-semibold text-[#8f8f9b]">{description}</p>
      </div>
    </div>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-[#dfdfe7] bg-white shadow-[0_10px_28px_rgba(21,21,29,0.07)]">
      {children}
    </div>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="h-32 text-center text-base font-semibold text-[#8f8f9b]">
        {children}
      </TableCell>
    </TableRow>
  );
}

function formatEventDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function AdjustUniformStockDialog({
  lot,
  open,
  onOpenChange,
  onSave,
  saving,
}: {
  lot: LotEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    lotId: string;
    quantity: number;
    condition: UniformCondition;
    uniformStockStatus: UniformStockStatus;
    notes?: string;
  }) => Promise<void>;
  saving: boolean;
}) {
  const [quantity, setQuantity] = useState("0");
  const [condition, setCondition] = useState<UniformCondition>("novo");
  const [uniformStockStatus, setUniformStockStatus] = useState<UniformStockStatus>("disponivel");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!lot || !open) return;
    setQuantity(String(Number(lot.quantity ?? 0)));
    setCondition((lot.condition ?? "novo") as UniformCondition);
    setUniformStockStatus((lot.uniformStockStatus ?? "disponivel") as UniformStockStatus);
    setNotes("");
  }, [lot, open]);

  if (!lot) return null;

  const parsedQuantity = Number(quantity);
  const canSave = Number.isInteger(parsedQuantity) && parsedQuantity >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[28px] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar estoque</DialogTitle>
          <DialogDescription>
            Altere quantidade, condição e disponibilidade deste lote de uniforme.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#e5e5eb] bg-[#f7f7f9] p-4">
            <p className="text-sm font-black text-[#1c1c25]">{lot.productName}</p>
            <p className="mt-1 text-xs font-semibold text-[#8f8f9b]">
              {sizeLabel(lot.apparelSize)} · {conditionLabel(lot.condition)} · lote {lot.lotNumber || "sem lote"}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Quantidade</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Condição</Label>
              <Select value={condition} onValueChange={(value) => setCondition(value as UniformCondition)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="novo">Novo</SelectItem>
                  <SelectItem value="usado">Usado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Status</Label>
              <Select
                value={uniformStockStatus}
                onValueChange={(value) => setUniformStockStatus(value as UniformStockStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="disponivel">Disponível</SelectItem>
                  <SelectItem value="em_avaliacao">Em avaliação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Observação</Label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Opcional"
                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!canSave || saving}
            onClick={() => onSave({
              lotId: lot.id,
              quantity: parsedQuantity,
              condition,
              uniformStockStatus,
              notes: notes.trim() || undefined,
            })}
          >
            {saving ? "Salvando..." : "Salvar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UniformManagement() {
  const { firebaseUser, permissions } = useAuth();
  const { products } = useProducts();
  const { toast } = useToast();
  const [overview, setOverview] = useState<UniformOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [stockLotToAdjust, setStockLotToAdjust] = useState<LotEntry | null>(null);
  const [instructionsTarget, setInstructionsTarget] = useState<LotEntry | UniformAssignment | UniformEvent | null>(null);
  const [adjustingStock, setAdjustingStock] = useState(false);
  const [activeTab, setActiveTab] = useState<UniformTab>("stock");
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>("all");
  const [stockStatusFilter, setStockStatusFilter] = useState<StockStatusFilter>("all");

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setOverview(await fetchUniformOverview(firebaseUser));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao carregar uniformes",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const available = overview.lots
      .filter((lot) => (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    const newItems = overview.lots
      .filter((lot) => lot.condition === "novo" && (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    const usedItems = overview.lots
      .filter((lot) => lot.condition === "usado" && (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    const activeAssignments = overview.assignments.filter((assignment) => assignment.quantityInPossession > 0);
    const inPossession = activeAssignments.reduce(
      (sum, assignment) => sum + assignment.quantityInPossession,
      0,
    );
    const collaboratorsInPossession = new Set(activeAssignments.map((assignment) => assignment.collaboratorUserId)).size;
    return { available, newItems, usedItems, inPossession, collaboratorsInPossession };
  }, [overview]);

  const productById = useMemo(() => {
    return new Map(products.map((product) => [product.id, product]));
  }, [products]);

  const getLotSize = useCallback((lot: LotEntry) => {
    const lotSize = String(lot.apparelSize ?? "").trim();
    if (lotSize) return lotSize;
    return productById.get(lot.productId)?.apparelSize ?? lot.apparelSize;
  }, [productById]);

  const sizeSummary = useMemo(() => {
    const rows = new Map<string, { size: string; available: number; inPossession: number }>();
    const ensure = (size?: string | null) => {
      const key = sizeLabel(size);
      const current = rows.get(key);
      if (current) return current;
      const row = { size: key, available: 0, inPossession: 0 };
      rows.set(key, row);
      return row;
    };

    overview.lots
      .filter((lot) => (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .forEach((lot) => {
        ensure(getLotSize(lot)).available += Number(lot.quantity ?? 0);
      });
    overview.assignments
      .filter((assignment) => assignment.quantityInPossession > 0)
      .forEach((assignment) => {
        ensure(assignment.apparelSize).inPossession += Number(assignment.quantityInPossession ?? 0);
      });

    return Array.from(rows.values()).sort((left, right) => left.size.localeCompare(right.size, "pt-BR"));
  }, [getLotSize, overview]);

  const normalizedQuery = useMemo(() => normalizeText(query), [query]);
  const activeFilters = conditionFilter !== "all" || stockStatusFilter !== "all";

  const filteredLots = useMemo(() => {
    return overview.lots.filter((lot) => {
      const status = lot.uniformStockStatus ?? "disponivel";
      const matchesCondition = conditionFilter === "all" || lot.condition === conditionFilter;
      const matchesStatus = stockStatusFilter === "all" || status === stockStatusFilter;
      const matchesQuery = matchesSearch(normalizedQuery, [
        lot.productName,
        uniformDetails(lot),
        getLotSize(lot),
        lot.lotNumber,
        conditionLabel(lot.condition),
        stockStatusLabel(status),
      ]);
      return matchesCondition && matchesStatus && matchesQuery;
    });
  }, [conditionFilter, getLotSize, normalizedQuery, overview.lots, stockStatusFilter]);

  const filteredAssignments = useMemo(() => {
    return overview.assignments
      .filter((assignment) => assignment.quantityInPossession > 0)
      .filter((assignment) => {
        const matchesCondition = conditionFilter === "all" || assignment.issuedCondition === conditionFilter;
        const matchesQuery = matchesSearch(normalizedQuery, [
          assignment.collaboratorName,
          assignment.productName,
          uniformDetails(assignment),
          assignment.apparelSize,
          conditionLabel(assignment.issuedCondition),
        ]);
        return matchesCondition && matchesQuery;
      });
  }, [conditionFilter, normalizedQuery, overview.assignments]);

  const assignmentsByCollaborator = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; total: number; items: UniformAssignment[] }>();
    filteredAssignments.forEach((assignment) => {
      const id = assignment.collaboratorUserId || assignment.collaboratorName;
      const current = groups.get(id) ?? { id, name: assignment.collaboratorName || "Colaborador", total: 0, items: [] };
      current.total += assignment.quantityInPossession;
      current.items.push(assignment);
      groups.set(id, current);
    });
    return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [filteredAssignments]);

  const filteredEvents = useMemo(() => {
    return overview.events.filter((event) => {
      const matchesCondition = conditionFilter === "all" || event.issuedCondition === conditionFilter;
      const matchesQuery = matchesSearch(normalizedQuery, [
        event.collaboratorName,
        event.productName,
        uniformDetails(event),
        event.apparelSize,
        eventLabel(event.eventType),
        conditionLabel(event.issuedCondition),
      ]);
      return matchesCondition && matchesQuery;
    });
  }, [conditionFilter, normalizedQuery, overview.events]);

  const canEditUniformCatalog = permissions.registration.items.edit === true;
  const canAdjustUniformStock =
    permissions.stock.uniforms?.manageEvaluation === true ||
    permissions.stock.inventoryControl?.editLot === true;
  const showStockActions = canEditUniformCatalog || canAdjustUniformStock;

  const openProductEditor = (productId?: string | null) => {
    const product = productId ? productById.get(productId) : null;
    if (!product) {
      toast({
        variant: "destructive",
        title: "Cadastro não encontrado",
        description: "Não foi possível localizar o cadastro desta peça.",
      });
      return;
    }
    setProductToEdit(product);
    setEditDialogOpen(true);
  };

  const handleAdjustUniformLot = async (input: {
    lotId: string;
    quantity: number;
    condition: UniformCondition;
    uniformStockStatus: UniformStockStatus;
    notes?: string;
  }) => {
    if (!firebaseUser) return;
    setAdjustingStock(true);
    try {
      await adjustUniformLot(firebaseUser, input);
      toast({ title: "Estoque de uniforme ajustado." });
      setStockLotToAdjust(null);
      await load();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao ajustar estoque",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setAdjustingStock(false);
    }
  };

  if (!permissions.stock.uniforms?.view) {
    return <p className="text-sm text-muted-foreground">Sem permissão para visualizar o estoque de uniformes.</p>;
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-3 rounded-[24px] border border-[#dfdfe7] bg-white text-[#8f8f9b]">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-base font-semibold">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Disponíveis"
          value={stats.available}
          description="peças em estoque"
          icon={Boxes}
          tone="bg-[#eef8ff] text-[#008bd6]"
        />
        <MetricCard
          label="Novos"
          value={stats.newItems}
          description={`${formatPercent(stats.newItems, stats.available)} do estoque`}
          icon={Sparkles}
          tone="bg-[#eafaf2] text-[#009b6d]"
        />
        <MetricCard
          label="Usados"
          value={stats.usedItems}
          description="aptos para reuso"
          icon={Recycle}
          tone="bg-[#fff8e8] text-[#d87600]"
        />
        <MetricCard
          label="Em posse"
          value={stats.inPossession}
          description={`com ${formatQuantity(stats.collaboratorsInPossession)} colaboradores`}
          icon={Users}
          tone="bg-[#f3edff] text-[#7c3aed]"
        />
      </div>

      {sizeSummary.length > 0 ? (
        <section className="space-y-3">
          <h2 className="px-1 text-sm font-black text-[#4c4c57]">Resumo por tamanho</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sizeSummary.map((row) => (
              <div key={row.size} className="rounded-2xl border border-[#dfdfe7] bg-white px-5 py-4">
                <p className="text-xs font-black uppercase text-[#8f8f9b]">Tamanho</p>
                <p className="mt-1 text-xl font-black text-[#171820]">{row.size}</p>
                <p className="mt-2 text-sm font-semibold text-[#8f8f9b]">
                  {formatQuantity(row.available)} disponível(is) · {formatQuantity(row.inPossession)} em posse
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as UniformTab)} className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <TabsList className="h-auto w-fit rounded-2xl bg-white/70 p-1.5 shadow-sm">
            <TabsTrigger
              value="stock"
              className="h-11 rounded-xl px-5 text-sm font-black data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              Estoque
            </TabsTrigger>
            <TabsTrigger
              value="possession"
              className="h-11 rounded-xl px-5 text-sm font-black data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              Em posse
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="h-11 rounded-xl px-5 text-sm font-black data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              Histórico
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <div className="relative min-w-0 sm:w-[460px]">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9c9ca8]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar peça ou colaborador..."
                className="h-12 w-full rounded-2xl border border-[#dfdfe7] bg-white pl-12 pr-4 text-base font-semibold text-[#1c1c25] outline-none transition focus:border-[#e8327c] focus:ring-4 focus:ring-[#e8327c]/10"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl border-[#dfdfe7] bg-white px-5 text-sm font-black text-[#555563] hover:bg-[#f7f7f9]"
              onClick={() => setShowFilters((current) => !current)}
            >
              <SlidersHorizontal className="mr-2 h-5 w-5" />
              Filtros
              {activeFilters ? <span className="ml-2 h-2.5 w-2.5 rounded-full bg-[#e8327c]" /> : null}
            </Button>
          </div>
        </div>

        {showFilters ? (
          <div className="grid gap-3 rounded-[24px] border border-[#dfdfe7] bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label>Condição</Label>
              <Select value={conditionFilter} onValueChange={(value) => setConditionFilter(value as ConditionFilter)}>
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="novo">Novo</SelectItem>
                  <SelectItem value="usado">Usado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status do estoque</Label>
              <Select value={stockStatusFilter} onValueChange={(value) => setStockStatusFilter(value as StockStatusFilter)}>
                <SelectTrigger className="h-12 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="disponivel">Disponível</SelectItem>
                  <SelectItem value="em_avaliacao">Em avaliação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="h-12 rounded-xl px-5 font-black text-[#8f8f9b]"
              onClick={() => {
                setConditionFilter("all");
                setStockStatusFilter("all");
              }}
            >
              Limpar
            </Button>
          </div>
        ) : null}

        <TabsContent value="stock" className="mt-0">
          <TableShell>
            <Table className="min-w-[1040px]">
              <TableHeader className="bg-[#fbfbfc]">
                <TableRow className="border-[#e8e8ee] hover:bg-[#fbfbfc]">
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Peça</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Tamanho</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Lote</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Condição</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Status</TableHead>
                  <TableHead className="px-6 py-5 text-right text-xs font-black uppercase text-[#9c9ca8]">Qtd.</TableHead>
                  {showStockActions ? <TableHead className="px-6 py-5 text-right text-xs font-black uppercase text-[#9c9ca8]">Ações</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLots.map((lot) => (
                  <TableRow key={lot.id} className="h-24 border-[#ececf0] hover:bg-[#fbfbfc]">
                    <TableCell className="px-6 py-5">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-4 text-left"
                        onClick={() => setInstructionsTarget(lot)}
                      >
                        <ItemPhoto item={lot} />
                        <div className="min-w-0">
                          <p className="truncate text-lg font-black text-[#1c1c25]">{lot.productName}</p>
                          {uniformDetails(lot) ? (
                            <p className="mt-1 truncate text-base font-semibold text-[#8f8f9b]">{uniformDetails(lot)}</p>
                          ) : null}
                          {hasUniformCareInstructions(lot) ? (
                            <p className="mt-1 text-xs font-black text-[#df2f78]">Instruções cadastradas</p>
                          ) : null}
                        </div>
                      </button>
                    </TableCell>
                    <TableCell className="px-6 py-5">
                      <Pill className="border border-[#dedee6] bg-white text-[#555563]">{sizeLabel(getLotSize(lot))}</Pill>
                    </TableCell>
                    <TableCell className="px-6 py-5">
                      <Pill className="border border-[#dedee6] bg-white text-[#555563]">{lotLabel(lot.lotNumber)}</Pill>
                    </TableCell>
                    <TableCell className="px-6 py-5"><ConditionPill value={lot.condition} /></TableCell>
                    <TableCell className="px-6 py-5"><StatusPill value={lot.uniformStockStatus} /></TableCell>
                    <TableCell className="px-6 py-5 text-right text-xl font-black text-[#171820]">
                      {formatQuantity(Number(lot.quantity ?? 0))}
                    </TableCell>
                    {showStockActions ? (
                      <TableCell className="px-6 py-5">
                        <div className="flex justify-end gap-2">
                          {canAdjustUniformStock ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              title="Ajustar estoque"
                              aria-label="Ajustar estoque"
                              className="h-11 w-11 rounded-xl border border-[#dfdfe7] bg-white text-[#8f8f9b] hover:bg-[#f7f7f9]"
                              onClick={() => setStockLotToAdjust({ ...lot, apparelSize: getLotSize(lot) })}
                            >
                              <SlidersHorizontal className="h-5 w-5" />
                            </Button>
                          ) : null}
                          {canEditUniformCatalog ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              title="Editar cadastro"
                              aria-label="Editar cadastro"
                              className="h-11 w-11 rounded-xl border border-[#dfdfe7] bg-white text-[#8f8f9b] hover:bg-[#f7f7f9]"
                              onClick={() => openProductEditor(lot.productId)}
                            >
                              <Pencil className="h-5 w-5" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
                {filteredLots.length === 0 ? (
                  <EmptyRow colSpan={showStockActions ? 7 : 6}>
                    Nenhuma peça encontrada.
                  </EmptyRow>
                ) : null}
              </TableBody>
            </Table>
          </TableShell>
        </TabsContent>

        <TabsContent value="possession" className="mt-0">
          <TableShell>
            <Table className="min-w-[980px]">
              <TableHeader className="bg-[#fbfbfc]">
                <TableRow className="border-[#e8e8ee] hover:bg-[#fbfbfc]">
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Colaborador</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Peça</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Tamanho</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Condição</TableHead>
                  <TableHead className="px-6 py-5 text-right text-xs font-black uppercase text-[#9c9ca8]">Qtd.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignmentsByCollaborator.map((group) => (
                  <Fragment key={group.id}>
                    <TableRow key={`${group.id}-summary`} className="border-[#ececf0] bg-[#fbfbfc] hover:bg-[#fbfbfc]">
                      <TableCell className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <CollaboratorAvatar name={group.name} />
                          <p className="max-w-[220px] text-xl font-black leading-tight text-[#1c1c25]">{group.name}</p>
                        </div>
                      </TableCell>
                      <TableCell colSpan={3} className="px-6 py-5">
                        <span className="inline-flex rounded-full bg-[#ededf0] px-4 py-1.5 text-sm font-black text-[#6f6f7b]">
                          {formatQuantity(group.total)} {group.total === 1 ? "peça" : "peças"} em posse · {formatQuantity(group.items.length)} {group.items.length === 1 ? "item" : "itens"}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-5 text-right text-xl font-black text-[#171820]">
                        {formatQuantity(group.total)}
                      </TableCell>
                    </TableRow>
                    {group.items.map((item) => (
                      <TableRow key={item.id} className="h-24 border-[#ececf0] hover:bg-[#fbfbfc]">
                        <TableCell className="px-6 py-5" />
                        <TableCell className="px-6 py-5">
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-4 text-left"
                            onClick={() => setInstructionsTarget(item)}
                          >
                            <ItemPhoto item={item} />
                            <div className="min-w-0">
                              <p className="truncate text-lg font-black text-[#1c1c25]">{item.productName}</p>
                              {uniformDetails(item) ? (
                                <p className="mt-1 truncate text-base font-semibold text-[#8f8f9b]">{uniformDetails(item)}</p>
                              ) : null}
                              {hasUniformCareInstructions(item) ? (
                                <p className="mt-1 text-xs font-black text-[#df2f78]">Instruções cadastradas</p>
                              ) : null}
                            </div>
                          </button>
                        </TableCell>
                        <TableCell className="px-6 py-5">
                          <Pill className="border border-[#dedee6] bg-white text-[#555563]">{sizeLabel(item.apparelSize)}</Pill>
                        </TableCell>
                        <TableCell className="px-6 py-5"><ConditionPill value={item.issuedCondition} /></TableCell>
                        <TableCell className="px-6 py-5 text-right text-xl font-black text-[#171820]">
                          {formatQuantity(item.quantityInPossession)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
                {assignmentsByCollaborator.length === 0 ? (
                  <EmptyRow colSpan={5}>
                    Nenhuma peça em posse encontrada.
                  </EmptyRow>
                ) : null}
              </TableBody>
            </Table>
          </TableShell>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <TableShell>
            <Table className="min-w-[980px]">
              <TableHeader className="bg-[#fbfbfc]">
                <TableRow className="border-[#e8e8ee] hover:bg-[#fbfbfc]">
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Data</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Colaborador</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Peça</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Tamanho</TableHead>
                  <TableHead className="px-6 py-5 text-xs font-black uppercase text-[#9c9ca8]">Movimento</TableHead>
                  <TableHead className="px-6 py-5 text-right text-xs font-black uppercase text-[#9c9ca8]">Qtd.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => (
                  <TableRow key={event.id} className="h-24 border-[#ececf0] hover:bg-[#fbfbfc]">
                    <TableCell className="px-6 py-5 text-lg font-semibold text-[#6f6f7b]">
                      {formatEventDate(event.occurredAt)}
                    </TableCell>
                    <TableCell className="px-6 py-5 text-lg font-black text-[#1c1c25]">
                      {event.collaboratorName || "Estoque"}
                    </TableCell>
                    <TableCell className="px-6 py-5">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-4 text-left"
                        onClick={() => setInstructionsTarget(event)}
                      >
                        <ItemPhoto item={event} />
                        <div className="min-w-0">
                          <p className="truncate text-lg font-black text-[#1c1c25]">{event.productName}</p>
                          {uniformDetails(event) ? (
                            <p className="mt-1 truncate text-base font-semibold text-[#8f8f9b]">{uniformDetails(event)}</p>
                          ) : null}
                          {hasUniformCareInstructions(event) ? (
                            <p className="mt-1 text-xs font-black text-[#df2f78]">Instruções cadastradas</p>
                          ) : null}
                        </div>
                      </button>
                    </TableCell>
                    <TableCell className="px-6 py-5">
                      <Pill className="border border-[#dedee6] bg-white text-[#555563]">{sizeLabel(event.apparelSize)}</Pill>
                    </TableCell>
                    <TableCell className="px-6 py-5"><MovementPill type={event.eventType} /></TableCell>
                    <TableCell className="px-6 py-5 text-right text-xl font-black text-[#171820]">
                      {formatQuantity(event.quantity)}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredEvents.length === 0 ? (
                  <EmptyRow colSpan={6}>
                    Nenhuma movimentação encontrada.
                  </EmptyRow>
                ) : null}
              </TableBody>
            </Table>
          </TableShell>
        </TabsContent>
      </Tabs>

      <AddEditProductModal
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        productToEdit={productToEdit}
        onManageBaseProducts={() => {
          toast({
            title: "Produto base",
            description: "Para alterar produtos base, acesse Configurações > Cadastros.",
          });
        }}
      />
      <AdjustUniformStockDialog
        lot={stockLotToAdjust}
        open={!!stockLotToAdjust}
        onOpenChange={(open) => { if (!open) setStockLotToAdjust(null); }}
        onSave={handleAdjustUniformLot}
        saving={adjustingStock}
      />
      <UniformInstructionsDialog
        item={instructionsTarget}
        open={!!instructionsTarget}
        onOpenChange={(open) => { if (!open) setInstructionsTarget(null); }}
      />
    </div>
  );
}
