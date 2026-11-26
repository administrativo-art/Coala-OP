"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { Button } from "@/components/ui/button";
import type { MappingView } from "../agent/configuration";
import type { FeeReferenceComparison } from "./fee-reference-comparison.server";
import { dayLabel,rateLabel } from "./stone-account-format";
export function FeeReferenceComparisonPanel({mapping,stoneCode,month,version}:{mapping:MappingView;stoneCode:string;month:string;version:number}) {
 const api=useAuthenticatedApi();
 const contextKey=JSON.stringify([mapping.id,mapping.kioskId,stoneCode,month,version]);
 const [stored,setStored]=useState<{contextKey:string;data:FeeReferenceComparison}|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [unit,setUnit]=useState("all");
 const lifecycle=useRef<{controller:AbortController|null;generation:number}>({controller:null,generation:0});
 const data=stored?.contextKey===contextKey?stored.data:null;
 useEffect(()=>{
   const state=lifecycle.current;state.generation++;state.controller?.abort();
   void Promise.resolve().then(()=>{setBusy(false);setError("");setUnit("all");});
   return ()=>{state.generation++;state.controller?.abort();};
 },[contextKey]);
 const load=async(requestedOffset=0)=>{
   const offset=data?requestedOffset:0;
   const state=lifecycle.current;state.controller?.abort();const controller=new AbortController();state.controller=controller;const requestId=++state.generation;
   setBusy(true);setError("");
   try{
     const query=new URLSearchParams({view:"references",kioskId:mapping.kioskId,stoneCode,month,offset:String(offset)});
     let next=await api<FeeReferenceComparison>(`/api/financial/stone-fees?${query}`,{signal:controller.signal});
     let effectiveOffset=offset;
     if(controller.signal.aborted||state.generation!==requestId)return;
     if(offset && data?.date!==next.date){
       query.set("offset","0");
       next=await api<FeeReferenceComparison>(`/api/financial/stone-fees?${query}`,{signal:controller.signal});
       effectiveOffset=0;
       if(controller.signal.aborted||state.generation!==requestId)return;
     }
     setStored(previous=>({contextKey,data:effectiveOffset && previous?.contextKey===contextKey && previous.data.date===next.date ? {...next,rows:[...previous.data.rows,...next.rows]} : next}));
   }catch{if(!controller.signal.aborted && state.generation===requestId)setError("Não foi possível comparar referências. Isso não significa taxa zero.");}
   finally{if(!controller.signal.aborted && state.generation===requestId)setBusy(false);}
 };
 const groupLabel=(key:string)=>key.split("|").map(part=>({credit:"crédito",debit:"débito",installment:"parcelado",pix:"Pix",other:"outra modalidade"}[part]??part)).join(" · ");
 return <section className="space-y-3 rounded-ds-card border border-ds-border bg-ds-surface p-4" aria-label="Taxas vigentes por unidade">
  <h2 className="font-bold">Taxas confirmadas por unidade</h2><p className="text-sm text-ds-ink-muted">Referências operacionais confirmadas, separadas por vínculo/conta e vigência. Não representam comprovação documental do contrato. A comparação carrega duas combinações de vínculo e StoneCode por vez.</p>
  <div className="flex flex-wrap items-end gap-3"><Button disabled={busy||!month} variant="ds-secondary" onClick={()=>void load()}>{data?"Atualizar comparação":"Comparar todas as unidades"}</Button>{data?<label className="grid gap-1 text-sm">Unidade<select className="rounded border p-2" value={unit} onChange={e=>setUnit(e.target.value)}><option value="all">Todas carregadas</option>{[...new Map(data.rows.filter(r=>r.kioskId!==null).map(r=>[r.kioskId!,r.unit])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>:null}</div>
  {busy?<p role="status">Carregando referências…</p>:null}{error?<p role="alert">{error}</p>:null}
  {stored && !data?<p role="status">Competência, vínculo ou decisões alteradas. Atualize a comparação para este contexto.</p>:null}
  {data?<><p className="text-xs">Referência em {dayLabel(data.date)} · {data.rows.length} de {data.totalScopes} vínculos/StoneCodes carregados. {data.invalidMappingCount?`${data.invalidMappingCount} cadastro(s) incompleto(s): cobertura indisponível nesses vínculos.`:""} Comparação parcial enquanto houver mais páginas.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Unidade / vínculo","Grupo","Vigente","Início","Autor / histórico"].map(t=><th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{data.rows.filter(r=>unit==="all"||r.kioskId===unit).map(row=><tr key={`${row.mappingId}:${row.stoneCode}`} className="border-t"><td className="p-2 align-top"><b>{row.unit}</b><br />{row.account} · {row.stoneCode}<br />{row.kioskId && row.stoneCode ? <Link className="underline" href={`/dashboard/financial/stone-receipts?tab=fees&mapping=${encodeURIComponent(row.mappingId)}&stoneCode=${row.stoneCode}&month=${month}`}>Investigar unidade</Link> : <span>Revise o cadastro do vínculo</span>}</td><td colSpan={4} className="p-2">{row.status!=="available"?<p>{row.status==="outside_period"?"Vínculo fora da competência":"Escopo ou fonte indisponível; não comparável"}</p>:<>{row.unresolved?<p>Há referências legadas sem comprovação de escopo/vigência.</p>:null}{!row.references.length?<p>Nenhuma referência confirmada vigente; sugestões não são aplicadas.</p>:null}{row.references.map(ref=><div key={ref.groupKey} className="grid gap-2 border-b py-2 sm:grid-cols-4"><b>{groupLabel(ref.groupKey)}</b><span>{rateLabel(ref.rate)}</span><span>{dayLabel(ref.since)}</span><details><summary>Autor {ref.actorId} · histórico</summary><ul>{row.history.filter(h=>h.groupKey===ref.groupKey).map(h=><li key={`${h.decisionId}:${h.revision}`}>{rateLabel(h.rate)} desde {dayLabel(h.since)} · confirmado {new Date(h.decidedAt).toLocaleString("pt-BR",{timeZone:"America/Belem"})} · autor {h.actorId} · revisão {h.revision}</li>)}</ul></details></div>)}</>}</td></tr>)}</tbody></table></div>{data.nextOffset!==null?<Button disabled={busy} variant="ds-secondary" onClick={()=>void load(data.nextOffset!)}>Carregar próximas unidades/vínculos</Button>:null}</>:null}
 </section>;
}
