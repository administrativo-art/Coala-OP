import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePricePerBaseUnit,
  calculateStockQuantityFromPurchase,
  getDefaultPurchaseUnitType,
} from '../../src/lib/purchasing-units';

const dairyBag = {
  packageSize: 2,
  unit: 'L',
  category: 'Volume' as const,
  multiplo_caixa: 10,
  rotulo_caixa: 'Caixa',
};

const dairyBase = {
  unit: 'ml',
};

test('usa a caixa como padrão quando a unidade logística está cadastrada', () => {
  assert.equal(getDefaultPurchaseUnitType(dairyBag), 'logistic');
  assert.equal(getDefaultPurchaseUnitType({ multiplo_caixa: 0, rotulo_caixa: '' }), 'content');
});

test('calcula preço e estoque da bebida láctea por caixa', () => {
  const price = calculatePricePerBaseUnit(170, dairyBag, dairyBase, 'logistic');
  const stock = calculateStockQuantityFromPurchase(20, dairyBag, dairyBag, dairyBase, 'logistic');

  assert.equal(price.ok, true);
  if (price.ok) {
    assert.equal(price.baseUnitsPerPurchaseUnit, 20_000);
    assert.equal(price.pricePerBaseUnit, 0.0085);
  }

  assert.equal(stock.ok, true);
  if (stock.ok) {
    assert.equal(stock.baseQuantity, 400_000);
    assert.equal(stock.stockQuantity, 200);
  }
});

test('mantém a compra avulsa disponível quando escolhida explicitamente', () => {
  const price = calculatePricePerBaseUnit(170, dairyBag, dairyBase, 'content');
  const stock = calculateStockQuantityFromPurchase(20, dairyBag, dairyBag, dairyBase, 'content');

  assert.equal(price.ok, true);
  if (price.ok) assert.equal(price.pricePerBaseUnit, 0.085);

  assert.equal(stock.ok, true);
  if (stock.ok) assert.equal(stock.stockQuantity, 20);
});

test('pacote de 100 sacos mantém preço do volume e lança 100 unidades no estoque', () => {
  const sack = {
    packageSize: 1,
    unit: 'un',
    category: 'Unidade' as const,
    multiplo_caixa: 100,
    rotulo_caixa: 'Pacote',
  };
  const base = { unit: 'un' };
  const price = calculatePricePerBaseUnit(78.97, sack, base, 'logistic');
  const stock = calculateStockQuantityFromPurchase(1, sack, sack, base, 'logistic');
  assert.equal(price.ok, true);
  if (price.ok) {
    assert.equal(price.baseUnitsPerPurchaseUnit, 100);
    assert.equal(price.pricePerBaseUnit, 0.7897);
  }
  assert.equal(stock.ok, true);
  if (stock.ok) {
    assert.equal(stock.baseQuantity, 100);
    assert.equal(stock.stockQuantity, 100);
  }
});
