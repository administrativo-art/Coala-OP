import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const marking = readFileSync('src/app/api/dp/time-recording/markings/route.ts', 'utf8');
const afd = readFileSync('src/app/api/dp/time-recording/afd/route.ts', 'utf8');
const schemas = readFileSync('src/features/dp/rep-p/schemas.ts', 'utf8');
const options = readFileSync('src/app/api/dp/time-recording/options/route.ts', 'utf8');
const offlinePermit = readFileSync('src/app/api/dp/time-recording/offline-permits/route.ts', 'utf8');
const pending = readFileSync('src/app/api/dp/time-recording/pending-receipts/route.ts', 'utf8');
const signerStatus = readFileSync('src/app/api/dp/time-recording/signer-status/route.ts', 'utf8');
const receipt = readFileSync('src/app/api/dp/time-recording/receipts/[receiptId]/route.ts', 'utf8');
const mobileAttestation = readFileSync('src/lib/security/mobile-app-attestation.server.ts', 'utf8');

describe('REP-P API route contracts', () => {
  it('records only the authenticated owner through a directly exported secure route', () => {
    assert.match(marking, /authorization: \{ kind: 'owner' \}/);
    assert.match(marking, /resourceScope: \{ kind: 'owner' \}/);
    assert.match(marking, /additionalGuarantees: \['replay-protected'\]/);
    assert.match(marking, /employeeId: actor\.decoded\.uid/);
    assert.match(marking, /export const POST = secureRoute/);
    const markingInput = schemas.split('export const repPMarkingSchema', 2)[1].split('export const repPAfdExportSchema', 1)[0];
    assert.match(markingInput, /attemptId:[\s\S]*workDate:[\s\S]*executionUnitId:[\s\S]*channel:/);
    assert.doesNotMatch(markingInput, /employeeCpf|employerCnpj|nsr:/);
    assert.match(markingInput, /offline:[\s\S]*channel !== 'mobile'/);
    assert.match(marking, /if \(parsed\.data\.offline\) assertOfficialMobileApp/);
  });

  it('issues offline permits only to the attested mobile owner', () => {
    assert.match(offlinePermit, /authorization: \{ kind: 'owner' \}/);
    assert.match(offlinePermit, /resourceScope: \{ kind: 'owner' \}/);
    assert.match(offlinePermit, /assertOfficialMobileApp\(request, actor\.decoded\.uid\)/);
    assert.match(offlinePermit, /control:mobile-app-attested/);
    assert.match(offlinePermit, /export const POST = secureRoute/);
    const strictGate = mobileAttestation.split('export function assertOfficialMobileApp', 2)[1];
    assert.match(strictGate, /currentMobileAttestationMode\(\) !== "enforce"/);
    assert.match(strictGate, /assertMobileAppAttested\(request, uid\)/);
  });

  it('restricts AFD export to the time manager and workspace', () => {
    assert.match(afd, /requireTimeManager\(request\)/);
    assert.match(afd, /resourceScope: \{ kind: 'workspace' \}/);
    assert.match(afd, /export const POST = secureRoute/);
    assert.match(afd, /private, no-store/);
  });

  it('serves receipts only to their owner, with a side-effect free GET and a separate retry', () => {
    assert.match(receipt, /authorization: \{ kind: 'owner' \}/);
    assert.match(receipt, /employeeId: actor\.decoded\.uid/);
    assert.match(receipt, /export const GET = secureRoute/);
    assert.match(receipt, /export const POST = secureRoute/);
    assert.match(receipt, /surface: \{ method: 'GET', path \}, effects: \{ mode: 'read', audit: 'none' \}/);
    assert.doesNotMatch(receipt.split('export const GET', 2)[1].split('export const POST', 1)[0], /retryOwnRepPReceipt/);
    assert.match(receipt, /private, no-store/);
  });

  it('lists own history and options only for the caller, and pending receipts only for the time manager', () => {
    const history = marking.split('const historyContract', 2)[1];
    assert.match(history, /surface: \{ method: 'GET', path \}/);
    assert.match(history, /authorization: \{ kind: 'owner' \}/);
    assert.match(history, /employeeId: actor\.decoded\.uid/);
    assert.match(marking, /export const GET = secureRoute/);
    assert.match(options, /authorization: \{ kind: 'owner' \}/);
    assert.match(options, /employeeId: actor\.decoded\.uid/);
    assert.match(pending, /requireTimeManager\(request\)/);
    assert.match(pending, /resourceScope: \{ kind: 'workspace' \}/);
    assert.match(signerStatus, /requireTimeManager\(request\)/);
    for (const source of [history, options, pending, signerStatus]) assert.match(source, /effects: \{ mode: 'read', audit: 'none' \}/);
  });
});
