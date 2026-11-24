import assert from 'node:assert/strict';
import test from 'node:test';

import { purchasePackIssue, purchasePackPreview, purchaseProductForPack, suggestedUnitsPerPackage } from '../../src/lib/purchase-packaging';
import { calculateStockQuantityFromPurchase } from '../../src/lib/purchasing-units';

test('compra de quatro embalagens com cem unidades mostra entrada e custo corretos', () => {
  assert.equal(suggestedUnitsPerPackage('Kit 100 Suporte Porta Copo'), 100);
  assert.equal(suggestedUnitsPerPackage('Saco Kraft C/100'), 100);
  assert.equal(suggestedUnitsPerPackage('Suporte individual 1un'), null);
  assert.deepEqual(purchasePackPreview(4, 52.90, 0, 100, 'individual'), {
    total: 211.60,
    stockQuantity: 400,
    stockUnitCost: 0.529,
  });
  assert.deepEqual(purchasePackPreview(4, 52.90, 0, 100, 'package'), {
    total: 211.60,
    stockQuantity: 4,
    stockUnitCost: 52.90,
  });
});

test('bloqueia cadastro de estoque incompatível com a escolha da embalagem', () => {
  const individual = { packageSize: 1, unit: 'un', multiplo_caixa: 0, rotulo_caixa: '' };
  const packageProduct = { packageSize: 100, unit: 'un', multiplo_caixa: 0, rotulo_caixa: '' };
  assert.equal(purchasePackIssue(individual, 100, 'individual'), null);
  assert.match(purchasePackIssue(individual, 100, 'package') || '', /cadastro de embalagem/);
  assert.equal(purchasePackIssue(packageProduct, 100, 'package'), null);
  assert.match(purchasePackIssue(packageProduct, 100, 'individual') || '', /unidade avulsa/);
  assert.match(purchasePackIssue(individual, 1, 'individual') || '', /Informe/);
});

test('o recebimento usa o multiplicador da linha sem mudar o cadastro avulso', () => {
  const product = { packageSize: 1, unit: 'un', category: 'Unidade' as const, multiplo_caixa: 0, rotulo_caixa: '' };
  const purchaseProduct = purchaseProductForPack(product, true, 100, 'individual');
  const conversion = calculateStockQuantityFromPurchase(4, purchaseProduct, product, { unit: 'un' }, 'logistic');
  assert.equal(conversion.ok, true);
  if (conversion.ok) assert.equal(conversion.stockQuantity, 400);
  assert.equal(product.multiplo_caixa, 0);
});
