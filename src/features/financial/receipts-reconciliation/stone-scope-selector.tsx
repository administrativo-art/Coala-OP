import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
};

function dateLabel(value: string | null | undefined) {
  return value ? value.split("-").reverse().join("/") : "sem data final";
}

export function StoneScopeSelector({
  mappings, mappingId, stoneCode, busy = false, loaded, error, cursor, onMappingChange, onStoneCodeChange, onRefresh, onLoadMore,
}: StoneScopeSelectorProps) {
  const mapping = mappings.find(item => item.id === mappingId);
  return <Card className="rounded-2xl border-ds-border bg-white">
    <CardContent className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">Escopo da consulta</p>
          <p className="mt-1 text-sm text-muted-foreground">A unidade, a conta e o StoneCode valem para toda a etapa atual.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRefresh}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
            {loaded ? "Atualizar vínculos" : "Carregar vínculos"}
          </Button>
          {cursor && onLoadMore ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onLoadMore}>Mais vínculos</Button> : null}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.85fr)_minmax(0,1fr)] lg:items-end">
        <label className="grid gap-1.5 text-sm font-semibold text-ds-ink-2">Unidade / conta bancária
          <select aria-label="Vínculo oficial" disabled={busy || !mappings.length} className="h-11 rounded-xl border border-ds-border bg-ds-input px-3 text-sm font-semibold text-ds-ink outline-none focus:ring-2 focus:ring-ds-accent" value={mappingId} onChange={event => onMappingChange(event.target.value)}>
            <option value="">{mappings.length ? "Selecione o vínculo oficial" : "Nenhum vínculo carregado"}</option>
            {mappings.map(item => <option key={item.id} value={item.id}>{item.kioskName} — {item.accountName}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-ds-ink-2">StoneCode
          <select aria-label="StoneCode" disabled={busy || !mapping} className="h-11 rounded-xl border border-ds-border bg-ds-input px-3 text-sm font-semibold text-ds-ink outline-none focus:ring-2 focus:ring-ds-accent disabled:text-muted-foreground" value={stoneCode} onChange={event => onStoneCodeChange(event.target.value)}>
            <option value="">{mapping ? "Selecione" : "Selecione a unidade primeiro"}</option>
            {mapping?.stoneCodes.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className="rounded-xl bg-ds-input px-3 py-2.5 text-xs leading-5 text-ds-ink-muted">
          {mapping ? <><strong className="block text-sm text-ds-ink-2">Vínculo vigente</strong>{dateLabel(mapping.validFrom)} a {dateLabel(mapping.validTo)}.</> : "Selecione um vínculo para conferir sua vigência e os StoneCodes disponíveis."}
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {loaded && !mappings.length ? <p role="status" className="mt-3 rounded-xl border border-ds-alert-border bg-ds-warn-bg p-3 text-sm text-ds-alert-ink">Nenhum vínculo disponível. Configure unidade, conta e StoneCode antes da consulta.</p> : null}
    </CardContent>
  </Card>;
}
