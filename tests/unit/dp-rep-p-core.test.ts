import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hashRepPType7,
  prepareRepPMarking,
  serializeRepPType7HashSource,
  verifyRepPChain,
  verifyRepPMarkingCandidate,
  type RepPMarkingCandidate,
  type RepPMarkingInput,
  type RepPSequenceState,
} from '../../src/features/dp/rep-p/core';

function fixture(overrides: Partial<RepPMarkingInput> = {}): RepPMarkingInput {
  return {
    attemptId: 'attempt-a', workspaceId: 'workspace-a', employeeId: 'employee-a',
    employeeCpf: '529.982.247-25', employmentHistoryId: 'employment-a', employmentRevision: 1,
    employerUnitId: 'employer-unit-a', employerCnpj: '14.276.603/0001-25',
    establishmentId: 'establishment-a', executionUnitId: 'unit-a',
    markedAt: '2026-10-18T08:15:00-0300', recordedAt: '2026-10-18T08:15:00-0300',
    collectorId: '01', mode: '0', ...overrides,
  };
}

function firstState(existingAttempt: RepPMarkingCandidate | null = null): RepPSequenceState {
  return { nextNsr: 1, previousRecord: null, existingAttempt };
}

function created(input = fixture(), state = firstState()) {
  const result = prepareRepPMarking(input, state);
  assert.equal(result.status, 'created');
  return result;
}

describe('REP-P synthetic core', () => {
  it('matches a fixed official-layout type 7 SHA-256 vector', () => {
    const source = serializeRepPType7HashSource({
      nsr: 1, markedAt: '2026-10-18T08:15:00-0300', employeeCpf: '52998224725',
      recordedAt: '2026-10-18T08:15:00-0300', collectorId: '01', mode: '0', previousHash: null,
    });
    assert.equal(source.length, 73);
    assert.equal(source, '1        72026-10-18T08:15:00-030052998224725 2026-10-18T08:15:00-0300010');
    assert.equal(hashRepPType7({ nsr: 1, markedAt: '2026-10-18T08:15:00-0300', employeeCpf: '52998224725',
      recordedAt: '2026-10-18T08:15:00-0300', collectorId: '01', mode: '0', previousHash: null }),
    'f5b6049b99e664d244de8f7935eb9816241683143e26872dfab2d17ebd944982');
  });

  it('prepares an immutable first marking and a deliberately blocked receipt seed', () => {
    const result = created();
    assert.equal(result.marking.nsr, 1);
    assert.equal(result.marking.nsrField, '1        ');
    assert.equal(result.marking.employeeCpf, '52998224725');
    assert.equal(result.marking.employeeCpfField, '52998224725 ');
    assert.equal(result.marking.employerCnpj, '14276603000125');
    assert.equal(result.marking.employerUnitId, 'employer-unit-a');
    assert.equal(result.marking.executionUnitId, 'unit-a');
    assert.equal(result.marking.persistenceStatus, 'not_persisted');
    assert.equal(result.marking.complianceStatus, 'synthetic_only');
    assert.equal(result.marking.receiptSeed.status, 'blocked_missing_legal_prerequisites');
    assert.deepEqual(result.marking.receiptSeed.missingLegalPrerequisites,
      ['employerLegalName', 'workLocationDescription', 'inpiRegistration', 'padesSignature']);
    assert.ok(Object.isFrozen(result.marking));
    assert.ok(Object.isFrozen(result.marking.receiptSeed));
    assert.ok(verifyRepPMarkingCandidate(result.marking));
  });

  it('chains the next NSR to the previous type 7 hash', () => {
    const first = created();
    const second = created(fixture({ attemptId: 'attempt-b', markedAt: '2026-10-18T12:00:00-0300',
      recordedAt: '2026-10-18T12:00:00-0300' }), first.sequenceAfter);
    assert.equal(second.marking.nsr, 2);
    assert.equal(second.marking.previousHash, first.marking.hash);
    assert.notEqual(second.marking.hash, first.marking.hash);
    assert.ok(verifyRepPChain([first.marking, second.marking]));
  });

  it('starts an independent NSR sequence for each fiscal establishment', () => {
    const first = created();
    const other = created(fixture({ attemptId: 'attempt-other', establishmentId: 'establishment-b',
      executionUnitId: 'unit-b' }));
    assert.equal(first.marking.nsr, 1);
    assert.equal(other.marking.nsr, 1);
    assert.notEqual(first.marking.markingId, other.marking.markingId);
    assert.equal(verifyRepPChain([first.marking, other.marking]), false);
  });

  it('replays the same attempt without allocating another NSR and rejects changed content', () => {
    const first = created();
    const replay = prepareRepPMarking(fixture(), { nextNsr: 99, previousRecord: null,
      existingAttempt: first.marking });
    assert.equal(replay.status, 'replayed');
    if (replay.status === 'replayed') assert.deepEqual(replay.marking, first.marking);

    const conflict = prepareRepPMarking(fixture({ markedAt: '2026-10-18T08:16:00-0300',
      recordedAt: '2026-10-18T08:16:00-0300' }), { nextNsr: 2, previousRecord: first.sequenceAfter.previousRecord,
      existingAttempt: first.marking });
    assert.deepEqual(conflict, { status: 'rejected', issue: 'ATTEMPT_CONFLICT' });
  });

  it('does not deduplicate distinct attempts merely because their timestamps match', () => {
    const first = created();
    const second = created(fixture({ attemptId: 'attempt-b' }), first.sequenceAfter);
    assert.equal(second.marking.nsr, 2);
    assert.notEqual(second.marking.markingId, first.marking.markingId);
  });

  it('creates an offline type 7 with distinct marking and recording instants', () => {
    const result = created(fixture({ mode: '1', markedAt: '2026-10-18T08:15:00-0300',
      recordedAt: '2026-10-18T09:00:00-0300' }));
    assert.equal(result.marking.mode, '1');
    assert.equal(result.marking.markedAt, '2026-10-18T08:15:00-0300');
    assert.equal(result.marking.recordedAt, '2026-10-18T09:00:00-0300');
    assert.equal(verifyRepPMarkingCandidate(result.marking), true);
  });

  it('fails closed on invalid identity, timestamps and collector', () => {
    const invalid: Partial<RepPMarkingInput>[] = [
      { employeeCpf: '111.111.111-11' }, { employerCnpj: '11.111.111/1111-11' },
      { markedAt: '2026-10-18T08:15:12-0300' }, { markedAt: '2026-02-30T08:15:00-0300' },
      { recordedAt: '2026-10-18T08:14:00-0300' }, { collectorId: '99' as RepPMarkingInput['collectorId'] },
      { employmentRevision: 0 }, { establishmentId: ' ' },
    ];
    for (const override of invalid) {
      assert.deepEqual(prepareRepPMarking(fixture(override), firstState()),
        { status: 'rejected', issue: 'INVALID_INPUT' });
    }
  });

  it('accepts NSRs consumed by other event types and rejects invalid previous marking anchors', () => {
    const hash = 'a'.repeat(64);
    assert.equal(prepareRepPMarking(fixture(), { nextNsr: 3, previousRecord: null }).status, 'created');
    assert.equal(prepareRepPMarking(fixture(), {
      nextNsr: 4, previousRecord: { establishmentId: 'establishment-a', nsr: 1, hash },
    }).status, 'created');
    const states: RepPSequenceState[] = [
      { nextNsr: 2, previousRecord: { establishmentId: 'establishment-b', nsr: 1, hash } },
      { nextNsr: 3, previousRecord: { establishmentId: 'establishment-a', nsr: 3, hash } },
      { nextNsr: 2, previousRecord: { establishmentId: 'establishment-a', nsr: 1, hash: 'invalid' } },
    ];
    for (const state of states) {
      assert.deepEqual(prepareRepPMarking(fixture(), state),
        { status: 'rejected', issue: 'INVALID_SEQUENCE' });
    }
  });

  it('detects any later alteration and refuses a corrupt idempotent replay', () => {
    const first = created();
    const altered = structuredClone(first.marking) as RepPMarkingCandidate;
    (altered as { executionUnitId: string }).executionUnitId = 'unit-b';
    assert.equal(verifyRepPMarkingCandidate(altered), false);
    assert.deepEqual(prepareRepPMarking(fixture(), { nextNsr: 2,
      previousRecord: first.sequenceAfter.previousRecord, existingAttempt: altered }),
    { status: 'rejected', issue: 'EXISTING_ATTEMPT_INVALID' });
    const alteredReceipt = structuredClone(first.marking) as RepPMarkingCandidate;
    (alteredReceipt.receiptSeed as { status: string }).status = 'available';
    assert.equal(verifyRepPMarkingCandidate(alteredReceipt), false);
  });

  it('accepts a punch without scale, tolerance or overtime authorization inputs', () => {
    const result = created(fixture({ executionUnitId: 'exceptional-coverage-unit' }));
    assert.equal(result.marking.employerUnitId, 'employer-unit-a');
    assert.equal(result.marking.executionUnitId, 'exceptional-coverage-unit');
    assert.equal('shiftId' in result.marking, false);
    assert.equal('overtimeAuthorization' in result.marking, false);
    assert.equal('toleranceMinutes' in result.marking, false);
  });
});
