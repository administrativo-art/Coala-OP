import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MappingView } from "../agent/configuration";

type StoneScopeSelectorProps = {
  mappings: MappingView[];
  mappingId: string;
  stoneCode: string;
  busy?: boolean;
  loaded: boolean;
  error?: string;
  cursor?: string | null;
  onMappingChange: (mappingId: string) => void;
  onStoneCodeChange: (stoneCode: string) => void;
  onRefresh: () => void;
  onLoadMore?: () => void;
  /** Ações extras do escopo (por exemplo, configurar vínculos), no mesmo estilo secundário. */
  actions?: React.ReactNode;
};

function dateLabel(value: string | null | undefined) {
  return value ? value.split("-").reverse().join("/") : "sem data final";
}

export function StoneScopeSelector({
  mappings, mappingId, stoneCode, busy = false, loaded, error, cursor, onMappingChange, onStoneCodeChange, onRefresh, onLoadMore, actions,
}: StoneScopeSelectorProps) {
  const mapping = mappings.find(item => item.id === mappingId);
  return <Card className="rounded-2xl border-ds-border bg-white">
    <CardContent className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Escopo da consulta</p>
          <p className="mt-1 text-sm text-muted-foreground">Escolha onde a venda ocorreu. A unidade, a conta e o StoneCode valem para todas as etapas.</p>
        </div>
        <div className="flex gap-2">
          {actions}
          <Button type="button" size="sm" variant="ds-secondary" disabled={busy} onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {loaded ? "Atualizar vínculos" : "Carregar vínculos"}
          </Button>
          {cursor && onLoadMore ? <Button type="button" size="sm" variant="ds-secondary" disabled={busy} onClick={onLoadMore}>Mais vínculos</Button> : null}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.85fr)_minmax(0,1fr)] lg:items-end">
        <div className="grid gap-1.5">
          <span className="text-xs font-bold text-ds-ink-2">Unidade e conta vinculada</span>
          <Select value={mappingId || undefined} onValueChange={onMappingChange} disabled={busy || !mappings.length}>
            <SelectTrigger aria-label="Vínculo oficial" className="font-semibold"><SelectValue placeholder={mappings.length ? "Selecione o vínculo oficial" : "Nenhum vínculo carregado"} /></SelectTrigger>
            <SelectContent>{mappings.map(item => <SelectItem key={item.id} value={item.id}>{item.kioskName} — {item.accountName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-bold text-ds-ink-2">Identificador na Stone (StoneCode)</span>
          <Select value={stoneCode || undefined} onValueChange={onStoneCodeChange} disabled={busy || !mapping}>
            <SelectTrigger aria-label="StoneCode" className="font-semibold"><SelectValue placeholder={mapping ? "Selecione" : "Selecione a unidade primeiro"} /></SelectTrigger>
            <SelectContent>{mapping?.stoneCodes.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex min-h-10 flex-col justify-center rounded-ds-md bg-ds-input px-3 py-1.5 text-xs leading-5 text-ds-ink-muted">
          {mapping ? <><strong className="block text-sm text-ds-ink-2">Vínculo vigente</strong>{dateLabel(mapping.validFrom)} a {dateLabel(mapping.validTo)}.</> : "Selecione um vínculo para conferir sua vigência e os StoneCodes disponíveis."}
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {loaded && !mappings.length ? <p role="status" className="mt-3 rounded-xl border border-ds-alert-border bg-ds-warn-bg p-3 text-sm text-ds-alert-ink">Nenhum vínculo disponível. Configure unidade, conta e StoneCode antes da consulta.</p> : null}
    </CardContent>
  </Card>;
}
