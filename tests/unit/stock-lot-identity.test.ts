import assert from 'node:assert/strict';
import test from 'node:test';
import { canReceiveUntrackedStock, groupStockLots, isUntrackedStockLot, physicalLotForAction, stockLotLabel, stockLotNumber, untrackedStockLotId } from '../../src/lib/stock-lot-identity';
import type { LotEntry } from '../../src/types';
import { WORKSPACE_ID } from '../../src/lib/workspace';

const lot = (id: string, overrides: Partial<LotEntry> = {}): LotEntry => ({
  id, productId: 'cup240', productName: 'Copo 240ml', kioskId: 'matriz',
  lotNumber: '', expiryDate: null, quantity: 1523, ...overrides,
});

test('estoque atual sem lote reúne vazio, hífen e espaços e preserva todos os IDs', () => {
  const input = [lot('empty', { expiryDate: '', reservedQuantity: 3 }), lot('hyphen', { workspaceId: WORKSPACE_ID, lotNumber: '-', quantity: 911, reservedQuantity: 7 }), lot('spaces', { lotNumber: '  ', quantity: 0 })];
  const original = structuredClone(input);
  const groups = groupStockLots(input);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].quantity, 2434);
  assert.equal(groups[0].reservedQuantity, 10);
  assert.deepEqual(groups[0].sourceLots.map(l => l.id), ['empty', 'hyphen', 'spaces']);
  assert.equal(stockLotLabel(groups[0]), 'Sem lote');
  assert.deepEqual(input, original);
});

test('saldo de 300 ml do relato é 3595 e não se mistura com outra apresentação', () => {
  const groups = groupStockLots([lot('240'), lot('300a', { productId: 'cup300', workspaceId: WORKSPACE_ID, lotNumber: '-', quantity: 3442 }), lot('300b', { productId: 'cup300', expiryDate: '', quantity: 118 }), lot('300c', { productId: 'cup300', lotNumber: '-', quantity: 35 })]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].quantity, 3595);
  assert.equal(groups[1].sourceLots.length, 3);
});

test('grupo exige escolha explícita antes de editar, excluir, movimentar ou baixar um ID', () => {
  const first = lot('first');
  const second = lot('second', { lotNumber: '-', quantity: 911, reservedQuantity: 7 });
  const [group] = groupStockLots([first, second]);
  assert.equal(physicalLotForAction(group), null);
  assert.equal(physicalLotForAction(group, 'other'), null);
  assert.equal(physicalLotForAction(group, 'second'), second);
  assert.equal(physicalLotForAction(group, 'second')?.quantity, 911);
  assert.equal(physicalLotForAction(groupStockLots([first])[0]), first);
});

test('não mistura códigos reais, datas, unidades, locais, workspace ou condições de uniforme', () => {
  const groups = groupStockLots([lot('blank'), lot('code', { lotNumber: 'CL-20261127' }),
    lot('dated', { lotNumber: '-', expiryDate: '2027-01-01' }), lot('other-date', { expiryDate: '2028-01-01' }),
    lot('unit', { kioskId: 'loja' }), lot('location', { locationId: 'prateleira' }),
    lot('workspace', { workspaceId: 'outro' }), lot('uniform', { condition: 'usado' })]);
  assert.equal(groups.length, 8);
});

test('novas entradas sem lote usam a mesma identidade em qualquer canal, só sem validade', () => {
  const expected = 'prod_cup240__kiosk_matriz__lot_-__exp_null';
  for (const code of ['', ' ', '-', ' - ']) {
    assert.equal(untrackedStockLotId(lot('x', { lotNumber: code })), expected);
    assert.equal(stockLotNumber(lot('x', { lotNumber: code })), '-');
  }
  for (const entry of [lot('x', { lotNumber: 'L123' }), lot('x', { expiryDate: '2027-01-01' })]) {
    assert.equal(untrackedStockLotId(entry), null);
    assert.equal(isUntrackedStockLot(entry), false);
    assert.equal(stockLotNumber(entry), entry.lotNumber);
  }
});

test('ID canônico não autoriza misturar um lote editado ou de outro contexto', () => {
  const incoming = lot('incoming', { lotNumber: '-' });
  assert.equal(canReceiveUntrackedStock(lot('legacy'), incoming), true);
  assert.equal(canReceiveUntrackedStock(lot('dated', { lotNumber: '-', expiryDate: '2028-01-01' }), incoming), false);
  assert.equal(stockLotLabel(lot('dated-without-code', { expiryDate: '2028-01-01' })), 'Sem número de lote');
  assert.equal(canReceiveUntrackedStock(lot('coded', { lotNumber: 'L123' }), incoming), false);
  assert.equal(canReceiveUntrackedStock(lot('other-unit', { kioskId: 'outra' }), incoming), false);
  assert.equal(canReceiveUntrackedStock(lot('other-product', { productId: 'copo300' }), incoming), false);
  assert.equal(canReceiveUntrackedStock(lot('other-workspace', { workspaceId: 'outro' }), incoming), false);
  assert.equal(canReceiveUntrackedStock(lot('uniform', { condition: 'novo' }), incoming), false);
});
