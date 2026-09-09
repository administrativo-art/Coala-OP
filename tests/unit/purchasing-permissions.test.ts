import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canRevertPurchaseStage } from '../../src/lib/purchasing-permissions';
import { defaultAdminPermissions, defaultGuestPermissions } from '../../src/types';

describe('permissão para retroceder pedido de compra', () => {
  it('é concedida ao administrador padrão e negada ao convidado', () => {
    assert.equal(canRevertPurchaseStage(defaultAdminPermissions), true);
    assert.equal(canRevertPurchaseStage(defaultGuestPermissions), false);
  });

  it('não é herdada das permissões comuns de criar, receber ou cancelar', () => {
    const permissions = structuredClone(defaultGuestPermissions);
    permissions.purchasing.createPurchase = true;
    permissions.purchasing.receivePurchase = true;
    permissions.purchasing.cancelPurchase = true;

    assert.equal(canRevertPurchaseStage(permissions), false);

    permissions.purchasing.revertPurchaseStage = true;
    assert.equal(canRevertPurchaseStage(permissions), true);
  });
});
