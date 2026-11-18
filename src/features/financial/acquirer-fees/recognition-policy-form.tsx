"use client";
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FeeRecognitionPolicy, FeeRateContract } from "./recognition-contracts";
export type FeeConfiguration = { policy: FeeRecognitionPolicy | null; accounts: Array<{ id: string; name: string; position: string }> };
export function RecognitionPolicyForm({ configuration, busy, onSave }: { configuration: FeeConfiguration; busy: boolean; onSave: (policy: FeeRecognitionPolicy) => void }) {
  const [draft, setDraft] = useState<FeeRecognitionPolicy>(() => configuration.policy ? { ...configuration.policy, version: configuration.policy.version + 1 } : { version:1,enabled:false,variableAccountId:"",financialAccountId:"",closedThroughMonth:null,closedPeriods:[],contracts:[] });
  const accountSelect = (label: string, field: "variableAccountId" | "financialAccountId", position: string) => <label className="grid gap-1 text-sm">{label}<select className="rounded border p-2" value={draft[field]} onChange={e => setDraft(p=>({...p,[field]:e.target.value}))}><option value="">Selecione a conta</option>{configuration.accounts.filter(a=>a.position===position).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>;
  const update = (index: number, patch: Partial<FeeRateContract>) => setDraft(p=>({...p,contracts:p.contracts.map((c,i)=>i===index?{...c,...patch}:c)}));
  const newContract = () => setDraft(p=>({...p,contracts:[...p.contracts,{id:crypto.randomUUID(),version:1,approvedAt:new Date().toISOString(),validFrom:"",validThrough:null,source:"cards",brandCode:null,accountTypeCode:null,minInstallments:1,maxInstallments:1,rateBasisPoints:Number.NaN,fixedCents:Number.NaN,rounding:"round"}]}));
  return <fieldset className="space-y-3 rounded border p-3" disabled={busy}><legend className="px-1 font-semibold">Configuração da apuração · revisão {draft.version}</legend>
    <p className="text-sm">Os percentuais confirmados em Recebimentos → Taxas são reutilizados por unidade e vigência. Configure aqui a classificação contábil e a autorização para reconhecer. Contratos documentais são opcionais; sem fonte nem referência confirmada, a taxa permanece desconhecida. O motivo é obrigatório e o histórico das revisões é preservado.</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft(p=>({...p,enabled:e.target.checked}))} />Habilitar apuração por venda conciliada</label>
    <div className="grid gap-3 sm:grid-cols-2">{accountSelect("Conta de taxas de venda (custos variáveis)","variableAccountId","custos_variaveis")}{accountSelect("Conta de antecipação (despesas financeiras)","financialAccountId","despesas_financeiras")}
      <label className="grid gap-1 text-sm">Bloquear apuração até a competência<Input type="month" value={draft.closedThroughMonth??""} onChange={e=>setDraft(p=>({...p,closedThroughMonth:e.target.value||null}))} /></label>
      <label className="grid gap-1 text-sm">Competências bloqueadas (AAAA-MM, separadas por vírgula)<Input value={draft.closedPeriods.join(",")} onChange={e=>setDraft(p=>({...p,closedPeriods:e.target.value.split(",").map(v=>v.trim()).filter(Boolean)}))} /></label>
    </div>
    <h3 className="font-semibold">Contratos documentais opcionais · não recadastre as referências de Recebimentos</h3>
    {draft.contracts.map((c,index)=>{const saved=configuration.policy?.contracts.some(old=>old.id===c.id&&old.version===c.version);return <fieldset key={`${c.id}:${c.version}`} className="space-y-2 rounded border p-3"><legend>Contrato {index+1} · revisão {c.version}</legend>
      {saved?<><p className="text-sm">Vigência {c.validFrom} até {c.validThrough??"sem término"} · {c.source==="pix"?"PIX Stone":"Cartão"} · {(c.rateBasisPoints/100).toFixed(2)}% + R${(c.fixedCents/100).toFixed(2)}. Revisão aprovada, preservada no histórico.</p><Button size="xs" variant="ds-secondary" onClick={()=>update(index,{version:c.version+1,approvedAt:new Date().toISOString()})}>Preparar nova revisão</Button></>:<div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">Meio<select value={c.source} onChange={e=>update(index,{source:e.target.value as "cards"|"pix"})}><option value="cards">Cartão</option><option value="pix">PIX Stone</option></select></label>
        <label className="grid gap-1 text-sm">Válido desde<Input type="date" required value={c.validFrom} onChange={e=>update(index,{validFrom:e.target.value})} /></label><label className="grid gap-1 text-sm">Válido até<Input type="date" value={c.validThrough??""} onChange={e=>update(index,{validThrough:e.target.value||null})} /></label>
        <label className="grid gap-1 text-sm">Modalidade<select value={c.accountTypeCode??""} onChange={e=>update(index,{accountTypeCode:e.target.value||null})}><option value="">Todas</option><option value="1">Débito</option><option value="2">Crédito</option><option value="3">Débito pré-pago</option><option value="4">Crédito pré-pago</option></select></label>
        <label className="grid gap-1 text-sm">Bandeira (código oficial; vazio = todas)<Input value={c.brandCode??""} onChange={e=>update(index,{brandCode:e.target.value||null})} /></label>
        <label className="grid gap-1 text-sm">Taxa percentual contratada<Input type="number" min="0" max="100" step="0.01" value={Number.isFinite(c.rateBasisPoints)?c.rateBasisPoints/100:""} onChange={e=>update(index,{rateBasisPoints:e.target.value===""?Number.NaN:Math.round(Number(e.target.value)*100)})} /></label>
        <label className="grid gap-1 text-sm">Tarifa fixa por parcela (R$)<Input type="number" min="0" step="0.01" value={Number.isFinite(c.fixedCents)?c.fixedCents/100:""} onChange={e=>update(index,{fixedCents:e.target.value===""?Number.NaN:Math.round(Number(e.target.value)*100)})} /></label>
        <label className="grid gap-1 text-sm">Mínimo de parcelas<Input type="number" min="1" max="99" value={c.minInstallments} onChange={e=>update(index,{minInstallments:Number(e.target.value)})} /></label><label className="grid gap-1 text-sm">Máximo de parcelas<Input type="number" min="1" max="99" value={c.maxInstallments} onChange={e=>update(index,{maxInstallments:Number(e.target.value)})} /></label>
        <label className="grid gap-1 text-sm">Arredondamento<select value={c.rounding} onChange={e=>update(index,{rounding:e.target.value as "round"|"floor"})}><option value="round">Centavo mais próximo</option><option value="floor">Truncar centavos</option></select></label>
      </div>}
      <Button size="xs" variant="ds-secondary" onClick={()=>setDraft(p=>({...p,contracts:p.contracts.filter((_,i)=>i!==index)}))}>Retirar da configuração vigente</Button>
    </fieldset>})}
    <Button size="xs" variant="ds-secondary" disabled={draft.contracts.length>=40} onClick={newContract}>Adicionar contrato comprovado</Button>
    <p className="text-xs">Novas revisões substituem a configuração vigente; o histórico continua nos eventos e nas taxas já reconhecidas. Não se reclassificam despesas anteriores.</p>
    <Button disabled={!draft.variableAccountId||!draft.financialAccountId||draft.contracts.some(c=>!Number.isFinite(c.rateBasisPoints)||!Number.isFinite(c.fixedCents)||!c.validFrom)} onClick={()=>onSave(draft)}>Salvar configuração com motivo</Button>
  </fieldset>;
}
