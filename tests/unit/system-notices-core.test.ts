import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canViewSystemNotices, repPCertificateMilestone, repPCertificateMilestoneSeverity, systemNoticeAudiencesFor,
  type SystemNoticeActor,
} from '../../src/features/system-notices/core';

function actor(overrides: { admin?: boolean; view?: boolean; notices?: boolean; manageTime?: boolean; allUnits?: boolean } = {}): SystemNoticeActor {
  return {
    isDefaultAdmin: overrides.admin ?? false,
    allUnits: overrides.allUnits ?? true,
    permissions: {
      settings: { view: overrides.view ?? true, viewSystemNotices: overrides.notices ?? true } as SystemNoticeActor['permissions']['settings'],
      dp: { settings: { manageTime: overrides.manageTime ?? false } },
    },
  };
}

describe('Avisos do sistema — acesso', () => {
  it('opens the center only for the default admin or settings.view + viewSystemNotices', () => {
    assert.equal(canViewSystemNotices(actor({ admin: true, view: false, notices: false })), true);
    assert.equal(canViewSystemNotices(actor()), true);
    assert.equal(canViewSystemNotices(actor({ notices: false })), false);
    assert.equal(canViewSystemNotices(actor({ view: false })), false);
  });

  it('shows each notice only to its audience, on top of the center permission', () => {
    assert.deepEqual(systemNoticeAudiencesFor(actor({ admin: true })), ['system.admin', 'dp.time-manager-global']);
    assert.deepEqual(systemNoticeAudiencesFor(actor()), []);
    assert.deepEqual(systemNoticeAudiencesFor(actor({ manageTime: true })), ['dp.time-manager-global']);
    assert.deepEqual(systemNoticeAudiencesFor(actor({ manageTime: true, allUnits: false })), []);
    assert.deepEqual(systemNoticeAudiencesFor(actor({ manageTime: true, notices: false })), []);
  });
});

describe('Avisos do sistema — marcos do certificado', () => {
  const notAfter = new Date('2027-06-16T14:49:42Z');
  const at = (iso: string) => repPCertificateMilestone(notAfter, new Date(iso), 'America/Fortaleza');

  it('maps civil days in the operating time zone to 60/45/30/15/7/5/4/3/2/1/0 and expired', () => {
    assert.equal(at('2027-04-01T12:00:00Z'), null);
    assert.deepEqual(at('2027-04-17T12:00:00Z'), { milestone: 60, daysRemaining: 60 });
    assert.deepEqual(at('2027-04-20T12:00:00Z'), { milestone: 60, daysRemaining: 57 });
    assert.deepEqual(at('2027-05-02T12:00:00Z'), { milestone: 45, daysRemaining: 45 });
    assert.deepEqual(at('2027-06-10T12:00:00Z'), { milestone: 7, daysRemaining: 6 });
    assert.deepEqual(at('2027-06-11T12:00:00Z'), { milestone: 5, daysRemaining: 5 });
    assert.deepEqual(at('2027-06-15T12:00:00Z'), { milestone: 1, daysRemaining: 1 });
    // 02:30Z do dia 16 ainda é dia 15 em Fortaleza (UTC−3).
    assert.deepEqual(at('2027-06-16T02:30:00Z'), { milestone: 1, daysRemaining: 1 });
    assert.deepEqual(at('2027-06-16T03:30:00Z'), { milestone: 0, daysRemaining: 0 });
    assert.deepEqual(at('2027-06-16T14:49:42Z'), { milestone: 0, daysRemaining: 0 });
    assert.deepEqual(at('2027-06-16T14:49:43Z'), { milestone: 'expired', daysRemaining: -1 });
  });

  it('raises severity as the date approaches', () => {
    assert.equal(repPCertificateMilestoneSeverity(60), 'info');
    assert.equal(repPCertificateMilestoneSeverity(45), 'info');
    assert.equal(repPCertificateMilestoneSeverity(30), 'warning');
    assert.equal(repPCertificateMilestoneSeverity(15), 'warning');
    assert.equal(repPCertificateMilestoneSeverity(7), 'critical');
    assert.equal(repPCertificateMilestoneSeverity(0), 'critical');
    assert.equal(repPCertificateMilestoneSeverity('expired'), 'critical');
  });
});
