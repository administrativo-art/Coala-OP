import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assert.equal(process.env.FIREBASE_PROJECT_ID, 'demo-coala-repository');
assertFirestoreEmulatorSafety({ projectId: process.env.FIREBASE_PROJECT_ID });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { untrackedStockLotId } = await import('../../src/lib/stock-lot-identity.ts');
const { finalizeRepositionActivityServer, revertRepositionActivityServer } = await import('../../src/features/reposition/lib/server.ts');

const actor = { userId: 'test-operator', username: 'Operador de teste' };
const origin = 'test-origin';
const destination = 'test-destination';

async function seed(t, lotCodes, amounts, occupied = {}) {
  const activityId = randomUUID();
  const product = { productId: activityId, productName: 'Descartável' };
  const destinationId = untrackedStockLotId({ ...product, kioskId: destination, lotNumber: '-' });
  const lots = dbAdmin.collection('lots');
  const target = lots.doc(destinationId);
  const sources = lotCodes.map((_, index) => lots.doc(`${activityId}-${index}`));
  const activity = dbAdmin.collection('repositionActivities').doc(activityId);
  const history = dbAdmin.collection('movementHistory').where('activityId', '==', activityId);
  t.after(async () => {
    const batch = dbAdmin.batch();
    for (const ref of [target, ...sources, activity, ...(await history.get()).docs.map(row => row.ref)]) batch.delete(ref);
    await batch.commit();
  });
  const batch = dbAdmin.batch();
  sources.forEach((ref, index) => batch.set(ref, {
    ...product, kioskId: origin, lotNumber: lotCodes[index],
    expiryDate: '', quantity: 100, reservedQuantity: amounts[index],
  }));
  batch.set(target, { ...product, kioskId: destination, lotNumber: '-', expiryDate: null, quantity: 50, ...occupied });
  batch.set(activity, {
    status: 'Recebido sem divergência',
    kioskOriginId: origin, kioskOriginName: 'Origem',
    kioskDestinationId: destination, kioskDestinationName: 'Destino',
    items: [{ suggestedLots: sources.map((ref, index) => ({
      ...product, lotId: ref.id, lotNumber: lotCodes[index], quantityToMove: amounts[index],
    })) }],
  });
  await batch.commit();
  return { activityId, activity, target, sources, history };
}

for (const { name, amounts } of [
  { name: 'saídas indistinguíveis são pareadas uma vez cada', amounts: [7, 7, 7] },
  { name: 'quantidades diferentes convergem e são estornadas integralmente', amounts: [4, 9, 2] },
]) {
  test(name, async t => {
    const scenario = await seed(t, ['', '-', ''], amounts);
    const { activityId, activity, target, sources, history } = scenario;
    await finalizeRepositionActivityServer({ activityId, resolution: 'trust_dispatch', actor });
    assert.equal((await target.get()).get('quantity'), 50 + amounts.reduce((sum, number) => sum + number, 0));
    for (const [index, source] of sources.entries()) assert.equal((await source.get()).get('quantity'), 100 - amounts[index]);

    const attempts = await Promise.allSettled([revertRepositionActivityServer(activityId, actor), revertRepositionActivityServer(activityId, actor)]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await activity.get()).get('status'), 'Aguardando despacho');
    assert.equal((await target.get()).get('quantity'), 50);
    for (const [index, source] of sources.entries()) {
      const snapshot = await source.get();
      assert.equal(snapshot.get('quantity'), 100);
      assert.equal(snapshot.get('reservedQuantity'), amounts[index]);
    }
    const movements = (await history.get()).docs.map(row => row.data());
    assert.equal(movements.filter(row => row.reverted).length, 6);
    assert.equal(new Set(movements.filter(row => row.revertedFromId).map(row => row.revertedFromId)).size, 6);
  });
}

test('destino canônico editado bloqueia efetivação sem alterar saldos ou movimentos', async t => {
  const { activityId, activity, target, sources, history } = await seed(t, [''], [7], { lotNumber: 'L123', expiryDate: '2029-01-01' });
  await assert.rejects(finalizeRepositionActivityServer({ activityId, resolution: 'trust_dispatch', actor }), /tem outra identificação/);
  assert.equal((await target.get()).get('lotNumber'), 'L123');
  assert.equal((await target.get()).get('quantity'), 50);
  assert.equal((await sources[0].get()).get('quantity'), 100);
  assert.equal((await sources[0].get()).get('reservedQuantity'), 7);
  assert.equal((await activity.get()).get('status'), 'Recebido sem divergência');
  assert.equal((await history.get()).size, 0);
});
