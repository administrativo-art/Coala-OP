import assert from 'node:assert/strict';
import test from 'node:test';

import {
  lotAvailableQuantity,
  lotMatchesStatusFilters,
  lotQuantityParts,
  lotStatusOf,
  validateWriteDown,
} from '../../src/components/stock/lot-presentation';

const today = new Date(2026, 9, 7);
const product: any = { unit: 'un', packageSize: 1, packageType: 'Unidade', urgentThreshold: 7 };

test('classifica a validade', () => {
    assert.equal(lotStatusOf({ expiryDate: null }, product, today).key, 'no_expiry');
    assert.equal(lotStatusOf({ expiryDate: '2026-10-04' }, product, today).key, 'expired');
    assert.equal(lotStatusOf({ expiryDate: '2026-10-07' }, product, today).text, 'Vence hoje');
    assert.equal(lotStatusOf({ expiryDate: '2026-10-14' }, product, today).key, 'expiring');
    assert.equal(lotStatusOf({ expiryDate: '2026-10-15' }, product, today).key, 'ok');
});

test('mostra a quantidade uma só vez quando a embalagem é a unidade', () => {
    assert.equal(lotQuantityParts({ quantity: 302 }, product).length, 1);
    const pack: any = { unit: 'un', packageSize: 50, packageType: 'Pacote', multiplo_caixa: 20, rotulo_caixa: 'Caixa' };
    assert.deepEqual(lotQuantityParts({ quantity: 40 }, pack).map((p) => p.unit), ['un', 'pacotes', 'caixas']);
});

test('disponível desconta a reserva e a baixa respeita o disponível', () => {
    const lot = { quantity: 10, reservedQuantity: 4 };
    assert.equal(lotAvailableQuantity(lot), 6);
    assert.equal(lotAvailableQuantity(lot, { total: 7, destinations: {} }), 3);
    assert.match(validateWriteDown({ quantity: '7', type: 'SAIDA_CONSUMO', notes: '', available: 6 }) ?? '', /maior que o disponível/);
    assert.match(validateWriteDown({ quantity: '0', type: 'SAIDA_CONSUMO', notes: '', available: 6 }) ?? '', /maior que zero/);
    assert.match(validateWriteDown({ quantity: '2', type: 'SAIDA_DESCARTE_OUTROS', notes: ' ', available: 6 }) ?? '', /obrigatória/);
    assert.equal(validateWriteDown({ quantity: '2', type: 'SAIDA_CONSUMO', notes: '', available: 6 }), null);
});

test('filtro de reserva usa a reserva do lote, não a validade', () => {
    const ok = lotStatusOf({ expiryDate: '2027-01-01' }, product, today);
    assert.equal(lotMatchesStatusFilters(['reserved'], ok, 3), true);
    assert.equal(lotMatchesStatusFilters(['reserved'], ok, 0), false);
    assert.equal(lotMatchesStatusFilters([], ok, 0), true);
});
