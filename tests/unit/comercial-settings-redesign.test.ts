import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildComparisonCsv,
  classifyGap,
  competitorAddress,
  correlatedSimulations,
  latestPriceByProduct,
  marginAtPrice,
  priceGapPercent,
  productsByCompetitor,
  summarizeComparison,
} from '../../src/components/competitors/competitors-model';

const NOW = new Date('2026-10-08T12:00:00Z').getTime();
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const product = (id: string, competitorId: string, ksProductId?: string) => ({ id, competitorId, itemName: id, ksProductId, active: true }) as never;
const price = (competitorProductId: string, value: number, date: string) => ({ id: `${competitorProductId}-${date}`, competitorProductId, price: value, data_coleta: date }) as never;
const sim = (id: string, salePrice: number, totalCmv = 4) => ({ id, name: `Sim ${id}`, salePrice, totalCmv, profitPercentage: 40 });

test('preço mais recente por produto vence, independentemente da ordem', () => {
  const map = latestPriceByProduct([price('p1', 10, day(5)), price('p1', 12, day(1)), price('p1', 9, day(9))]);
  assert.equal(map.get('p1')?.price, 12);
});

test('gap e classificação usam o limite de 5% e ignoram preço inválido', () => {
  assert.equal(priceGapPercent(10, 0), null);
  assert.equal(priceGapPercent(0, 10), null);
  assert.equal(Math.round(priceGapPercent(11, 10)!), 10);
  assert.equal(classifyGap(5.1), 'above');
  assert.equal(classifyGap(5), 'neutral');
  assert.equal(classifyGap(-5.1), 'below');
  assert.equal(marginAtPrice(10, 4), 60);
  assert.equal(marginAtPrice(0, 4), null);
});

test('simulações correlacionadas dependem dos concorrentes escolhidos', () => {
  const products = [product('p1', 'c1', 's1'), product('p2', 'c2', 's2'), product('p3', 'c1')];
  const map = productsByCompetitor(products);
  const sims = [sim('s1', 10), sim('s2', 10), sim('s3', 10)];
  assert.deepEqual(correlatedSimulations(sims, ['c1'], map).map((entry) => entry.id), ['s1']);
  assert.deepEqual(correlatedSimulations(sims, [], map), []);
});

test('resumo conta acima, abaixo, neutros e preços desatualizados', () => {
  const products = [product('p1', 'c1', 's1'), product('p2', 'c1', 's2'), product('p3', 'c1', 's3')];
  const map = productsByCompetitor(products);
  const prices = latestPriceByProduct([price('p1', 10, day(2)), price('p2', 10, day(40)), price('p3', 10, day(2))]);
  const rows = [sim('s1', 12), sim('s2', 8), sim('s3', 10)];
  const result = summarizeComparison(rows, ['c1'], map, prices, NOW);
  assert.deepEqual([result.above, result.below, result.neutral, result.stale, result.total], [1, 1, 1, 1, 3]);
});

test('CSV sai com BOM, separador ; e aspas escapadas', () => {
  const products = [product('p1', 'c1', 's1')];
  const csv = buildComparisonCsv([{ ...sim('s1', 12.5), name: 'Shake "grande"' }], ['c1'], [{ id: 'c1', name: 'Rival' }] as never, productsByCompetitor(products), latestPriceByProduct([price('p1', 10, day(1))]));
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /"Shake ""grande""";"12,50";"40,0";"10,00"/);
  assert.match(csv, /"Mercadoria";"Seu preço";"Sua margem %";"Rival"/);
});

test('endereço da unidade concorrente junta rua, cidade e UF sem sobrar vírgula', () => {
  assert.equal(competitorAddress({ address: 'Rua A, 10', city: 'São Luís', state: 'MA' } as never), 'Rua A, 10, São Luís - MA');
  assert.equal(competitorAddress({ city: 'São Luís' } as never), 'São Luís');
  assert.equal(competitorAddress({} as never), '');
});

const files = [
  'src/components/competitors/competitors-workspace.tsx',
  'src/components/competitors/competitor-panels.tsx',
  'src/components/purchasing/purchasing-accounting-settings.tsx',
];

test('Comercial usa o guia: sem hex, sem cor fora dos tokens e sem diálogo nativo', () => {
  for (const path of files) {
    const code = readFileSync(path, 'utf8');
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${path}: hex solto`);
    assert.doesNotMatch(code, /\b(?:bg|text|border)-(?:slate|pink|rose|emerald|violet|amber|sky|blue|indigo|red|green)-\d{2,3}\b/, `${path}: cor fora dos tokens`);
    assert.doesNotMatch(code, /\balert\(|\bconfirm\(|AlertDialog|DeleteConfirmationDialog/, `${path}: diálogo nativo`);
  }
});

test('Configurações do Comercial não oferece mais Metas nem Precificação', () => {
  const page = readFileSync('src/app/dashboard/settings/page.tsx', 'utf8');
  const commercial = page.slice(page.indexOf('const commercialTabs'), page.indexOf('const personalLeafTabs'));
  assert.doesNotMatch(commercial, /value: "(?:goals|pricing)"/);
  assert.match(commercial, /value: "purchasing"/);
  assert.match(commercial, /value: "competitors"/);
  assert.doesNotMatch(page, /PricingSimulator|GoalsProvider|CommercialGoalsPanel/);
});

test('exclusões do Comercial são confirmadas inline e explicam o efeito em cascata', () => {
  const panels = readFileSync('src/components/competitors/competitor-panels.tsx', 'utf8');
  assert.match(panels, /InlineConfirm/);
  assert.match(panels, /produtos e preços associados também serão excluídos/);
  assert.match(panels, /Isso também exclui permanentemente/);
});
