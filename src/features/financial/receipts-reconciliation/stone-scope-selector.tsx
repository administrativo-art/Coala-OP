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
  return <Card className="rounded-2xl border-[#e6e3dc] bg-white">
    <CardContent className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#8a8a94]">Escopo da consulta</p>
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
        <label className="grid gap-1.5 text-sm font-semibold text-[#4a4a55]">Unidade / conta bancária
          <select aria-label="Vínculo oficial" disabled={busy || !mappings.length} className="h-11 rounded-xl border border-[#e2e0da] bg-[#faf9f6] px-3 text-sm font-semibold text-[#1d1d26] outline-none focus:ring-2 focus:ring-[#df2f78]" value={mappingId} onChange={event => onMappingChange(event.target.value)}>
            <option value="">{mappings.length ? "Selecione o vínculo oficial" : "Nenhum vínculo carregado"}</option>
            {mappings.map(item => <option key={item.id} value={item.id}>{item.kioskName} — {item.accountName}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold text-[#4a4a55]">StoneCode
          <select aria-label="StoneCode" disabled={busy || !mapping} className="h-11 rounded-xl border border-[#e2e0da] bg-[#faf9f6] px-3 text-sm font-semibold text-[#1d1d26] outline-none focus:ring-2 focus:ring-[#df2f78] disabled:text-muted-foreground" value={stoneCode} onChange={event => onStoneCodeChange(event.target.value)}>
            <option value="">{mapping ? "Selecione" : "Selecione a unidade primeiro"}</option>
            {mapping?.stoneCodes.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className="rounded-xl bg-[#faf9f6] px-3 py-2.5 text-xs leading-5 text-[#6f6f7c]">
          {mapping ? <><strong className="block text-sm text-[#374151]">Vínculo vigente</strong>{dateLabel(mapping.validFrom)} a {dateLabel(mapping.validTo)}.</> : "Selecione um vínculo para conferir sua vigência e os StoneCodes disponíveis."}
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {loaded && !mappings.length ? <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Nenhum vínculo disponível. Configure unidade, conta e StoneCode antes da consulta.</p> : null}
    </CardContent>
  </Card>;
}
