import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cancelPurchaseSchema,
  revertPurchaseStageSchema,
} from '../../src/lib/purchasing-action-schemas';

describe('ações de pedido de compra', () => {
  it('normaliza e aceita um motivo de cancelamento válido', () => {
    const result = cancelPurchaseSchema.safeParse({ reason: '  Pedido duplicado  ' });

    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.reason, 'Pedido duplicado');
  });

  it('rejeita motivo vazio ou curto demais', () => {
    assert.equal(cancelPurchaseSchema.safeParse({ reason: '  ' }).success, false);
    assert.equal(cancelPurchaseSchema.safeParse({ reason: 'x' }).success, false);
  });

  it('rejeita motivos acima do limite de auditoria', () => {
    assert.equal(cancelPurchaseSchema.safeParse({ reason: 'x'.repeat(501) }).success, false);
  });

  it('normaliza o motivo de retrocesso para o registro de auditoria', () => {
    const result = revertPurchaseStageSchema.safeParse({ reason: '  Ajustar condição de pagamento  ' });

    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.reason, 'Ajustar condição de pagamento');
  });

  it('rejeita retrocesso sem motivo auditável', () => {
    assert.equal(revertPurchaseStageSchema.safeParse({ reason: '' }).success, false);
    assert.equal(revertPurchaseStageSchema.safeParse({ reason: 'x'.repeat(501) }).success, false);
  });
});
