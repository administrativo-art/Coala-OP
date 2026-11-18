import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RecognitionValues } from "../../src/features/financial/acquirer-fees/recognition-values";
import { RecognitionPolicyForm } from "../../src/features/financial/acquirer-fees/recognition-policy-form";
import type { FeeRecognitionBatch, FeeRecognitionRecord } from "../../src/features/financial/acquirer-fees/recognition-contracts";
test("R7: render após estimativa3→apurada2,50 mostra taxa/líquido vigentes e liquidação coerentes",()=>{
 const capture:FeeRecognitionBatch={id:"a",fingerprint:"b",kind:"mdr",soldOn:"2026-10-01",dueOn:"2026-10-31",amountCents:300,grossCents:10000,expectedNetCents:9700,measurement:"estimated",members:[]};
 const record={schemaVersion:2,active:true,state:"received",batch:{...capture,amountCents:250,measurement:"assessed",members:[{paidNetDecimal:"97.50"}]}} as FeeRecognitionRecord;
 const markup=renderToStaticMarkup(React.createElement("table",null,React.createElement("tbody",null,React.createElement("tr",null,React.createElement(RecognitionValues,{capture,record})))));
 assert.match(markup,/2,50/);assert.match(markup,/97,50/);assert.match(markup,/Apurada/);assert.match(markup,/Liquidado na adquirente/);assert.doesNotMatch(markup,/Estimada|3,00/);
});
test("configuração apresenta formulário de negócio sem editor JSON/valores contratuais inventados",()=>{
 const markup=renderToStaticMarkup(React.createElement(RecognitionPolicyForm,{configuration:{policy:null,accounts:[{id:"var",name:"Taxas de vendas",position:"custos_variaveis"},{id:"fin",name:"Antecipação",position:"despesas_financeiras"}]},busy:false,onSave:()=>{}}));
 assert.match(markup,/Conta de taxas de venda/);assert.match(markup,/Conta de antecipação/);assert.match(markup,/Adicionar contrato comprovado/);assert.doesNotMatch(markup,/JSON|textarea|rateBasisPoints/);
});
