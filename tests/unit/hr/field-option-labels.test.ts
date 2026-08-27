import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatFieldOptionLabel,
  formatPixKeyTypeLabel,
} from '../../../src/features/rh/lib/field-option-labels';

test('apresenta os tipos de chave PIX em português sem alterar o valor armazenado', () => {
  assert.equal(formatPixKeyTypeLabel('cpf'), 'CPF');
  assert.equal(formatPixKeyTypeLabel('cnpj'), 'CNPJ');
  assert.equal(formatPixKeyTypeLabel('phone'), 'Celular');
  assert.equal(formatPixKeyTypeLabel('email'), 'E-mail');
  assert.equal(formatPixKeyTypeLabel('random'), 'Chave aleatória');
});

test('preserva opções sem um rótulo específico', () => {
  assert.equal(formatFieldOptionLabel('employee.other_field', 'custom'), 'custom');
});
