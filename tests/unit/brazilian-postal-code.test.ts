import assert from 'node:assert/strict';
import test from 'node:test';

import { extractBrazilianPostalCode } from '../../src/lib/brazilian-postal-code';

test('extrai e normaliza CEP de um endereço completo', () => {
  assert.equal(
    extractBrazilianPostalCode('Avenida João Pessoa, nº 224, Filipinho, São Luís - MA, CEP 65042-815'),
    '65042-815',
  );
  assert.equal(extractBrazilianPostalCode('Rua Exemplo, 10 - 65042815'), '65042-815');
});

test('não inventa CEP quando o endereço não contém oito dígitos válidos', () => {
  assert.equal(extractBrazilianPostalCode('Rua sem CEP, número 224'), null);
});
