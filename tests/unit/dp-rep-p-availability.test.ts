import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planRepPAvailabilityTransition } from '../../src/features/dp/rep-p/availability';

describe('eventos de disponibilidade do REP-P', () => {
  it('grava indisponibilidade uma vez e disponibilidade ao encerrar o último incidente', () => {
    const opened = planRepPAvailabilityTransition({
      incidentId: 'incident-1', incomingState: 'open', storedIncidentState: null,
      storedUnavailableNsr: null, openIncidentIds: [],
    });
    assert.deepEqual(opened.eventCodes, ['08']);
    assert.deepEqual(opened.openIncidentIds, ['incident-1']);
    assert.equal(opened.serviceStatus, 'unavailable');

    const concurrent = planRepPAvailabilityTransition({
      incidentId: 'incident-2', incomingState: 'open', storedIncidentState: null,
      storedUnavailableNsr: null, openIncidentIds: opened.openIncidentIds,
    });
    assert.deepEqual(concurrent.eventCodes, []);

    const firstClosed = planRepPAvailabilityTransition({
      incidentId: 'incident-1', incomingState: 'closed', storedIncidentState: 'open',
      storedUnavailableNsr: 10, openIncidentIds: concurrent.openIncidentIds,
    });
    assert.deepEqual(firstClosed.eventCodes, []);
    assert.equal(firstClosed.serviceStatus, 'unavailable');

    const recovered = planRepPAvailabilityTransition({
      incidentId: 'incident-2', incomingState: 'closed', storedIncidentState: 'open',
      storedUnavailableNsr: null, openIncidentIds: firstClosed.openIncidentIds,
    });
    assert.deepEqual(recovered.eventCodes, ['07']);
    assert.equal(recovered.serviceStatus, 'available');
  });

  it('é idempotente para redelivery e preserva a ordem quando o fechamento chega primeiro', () => {
    const replay = planRepPAvailabilityTransition({
      incidentId: 'incident-1', incomingState: 'open', storedIncidentState: 'open',
      storedUnavailableNsr: 20, openIncidentIds: ['incident-1'],
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.eventCodes, []);

    const reordered = planRepPAvailabilityTransition({
      incidentId: 'incident-2', incomingState: 'closed', storedIncidentState: null,
      storedUnavailableNsr: null, openIncidentIds: [],
    });
    assert.deepEqual(reordered.eventCodes, ['08', '07']);
    assert.equal(reordered.serviceStatus, 'available');
  });
});
