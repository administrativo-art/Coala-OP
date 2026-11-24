import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { stoneReceiptFlowHref } from "../../src/features/financial/receipts-reconciliation/receipt-flow-navigation";
test("atalho DRE usa destino fixo e preserva competência/unidade como parâmetros separados",()=>{
 const href=stoneReceiptFlowHref("fees",undefined,undefined,{month:"2026-10",kioskId:"unit-a"});const url=new URL(href,"https://example.test");
 assert.equal(url.origin,"https://example.test");assert.equal(url.pathname,"/dashboard/financial/stone-receipts");assert.equal(url.searchParams.get("tab"),"fees");assert.equal(url.searchParams.get("month"),"2026-10");assert.equal(url.searchParams.get("kiosk"),"unit-a");
 assert.equal(new URL(stoneReceiptFlowHref("fees",undefined,undefined,{month:"2026-10",kioskId:null}),url.origin).searchParams.has("kiosk"),false);
});
test("mês inválido e metacaracteres DOM não se tornam HTML nem novos parâmetros no Link real",()=>{
 const payload='u&month=1900-01#"><img src=x onerror=alert(1)>';
 for(const month of ["javascript:alert(1)","2026-10&kiosk=other","2026-13",'<svg onload=alert(1)>']) {
  const href=stoneReceiptFlowHref("fees",undefined,undefined,{month,kioskId:payload});const url=new URL(href,"https://example.test");
  assert.equal(url.pathname,"/dashboard/financial/stone-receipts");assert.equal(url.hash,"");assert.equal(url.searchParams.has("month"),false);assert.equal(url.searchParams.get("kiosk"),payload);assert.deepEqual([...url.searchParams.keys()],["tab","kiosk"]);
  const html=renderToStaticMarkup(React.createElement(Link,{href},"Conferir taxas"));assert.match(html,/^<a /);assert.equal(html.includes("<img"),false);assert.equal(html.includes("<svg"),false);assert.equal(html.includes('href="javascript:'),false);assert.match(html,/href="\/dashboard\/financial\/stone-receipts\?/);
 }
});
