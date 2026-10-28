import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const marking = readFileSync('src/app/api/dp/time-recording/markings/route.ts', 'utf8');
const markingClassification = readFileSync('src/app/api/dp/time-recording/markings/[receiptId]/classification/route.ts', 'utf8');
const afd = readFileSync('src/app/api/dp/time-recording/afd/route.ts', 'utf8');
const schemas = readFileSync('src/features/dp/rep-p/schemas.ts', 'utf8');
const options = readFileSync('src/app/api/dp/time-recording/options/route.ts', 'utf8');
const journeyLocation = readFileSync('src/app/api/dp/time-recording/journey-location/route.ts', 'utf8');
const journeyLocationService = readFileSync('src/features/dp/rep-p/journey-location.server.ts', 'utf8');
const offlinePermit = readFileSync('src/app/api/dp/time-recording/offline-permits/route.ts', 'utf8');
const offlineCycle = readFileSync('src/app/api/dp/time-recording/offline-cycles/route.ts', 'utf8');
const pending = readFileSync('src/app/api/dp/time-recording/pending-receipts/route.ts', 'utf8');
const signerStatus = readFileSync('src/app/api/dp/time-recording/signer-status/route.ts', 'utf8');
const receipt = readFileSync('src/app/api/dp/time-recording/receipts/[receiptId]/route.ts', 'utf8');
const receiptArchive = readFileSync('src/app/api/dp/time-recording/receipts/export/route.ts', 'utf8');
const mobileAttestation = readFileSync('src/lib/security/mobile-app-attestation.server.ts', 'utf8');
const adjustmentService = readFileSync('src/features/dp/time-adjustments/service.server.ts', 'utf8');
const repPService = readFileSync('src/features/dp/rep-p/service.server.ts', 'utf8');
const closureService = readFileSync('src/features/dp/time-adjustments/closure.server.ts', 'utf8');
const reviewSection = readFileSync('src/features/dp/time-adjustments/review-section.tsx', 'utf8');
const hrIndexes = readFileSync('firestore.rh.indexes.json', 'utf8');

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

  it('changes only the owner organizational classification through an audited PATCH', () => {
    assert.match(markingClassification, /authorization: \{ kind: 'owner' \}/);
    assert.match(markingClassification, /employeeId: actor\.decoded\.uid/);
    assert.match(markingClassification, /repPMarkingClassificationSchema\.safeParse/);
    assert.match(markingClassification, /effects: \{ mode: 'write', audit: 'server-authoritative' \}/);
    assert.match(markingClassification, /export const PATCH = secureRoute/);
    assert.match(adjustmentService, /CLASSIFICATION_REQUESTS = 'ptrp_markingClassificationRequests'/);
    assert.match(adjustmentService, /source: 'reviewed'/);
    assert.match(repPService, /return deps\.hrDb\.runTransaction/);
    assert.match(repPService, /currentClassification\?\.purpose === parsed\.data\.purpose/);
    assert.match(adjustmentService, /PTRP_CLASSIFICATION_CLOSURE_CHANGED/);
    assert.match(closureService, /ptrp_markingClassificationRequests/);
    assert.match(reviewSection, /A decisão altera somente a classificação organizacional/);
    assert.match(reviewSection, /Aprovar classificação/);
  });

  it('issues offline permits only to the attested mobile owner', () => {
    assert.match(offlineCycle, /authorization: \{ kind: 'owner' \}/);
    assert.match(offlineCycle, /assertOfficialMobileApp\(request, actor\.decoded\.uid\)/);
    assert.match(offlineCycle, /export const POST = secureRoute/);
    assert.match(offlinePermit, /authorization: \{ kind: 'owner' \}/);
    assert.match(offlinePermit, /resourceScope: \{ kind: 'owner' \}/);
    assert.match(offlinePermit, /assertOfficialMobileApp\(request, actor\.decoded\.uid\)/);
    assert.match(offlinePermit, /control:mobile-app-attested/);
    assert.match(offlinePermit, /export const POST = secureRoute/);
    const strictGate = mobileAttestation.split('export function assertOfficialMobileApp', 2)[1];
    assert.match(strictGate, /currentOfflineAttestationMode\(\)/);
    assert.match(strictGate, /mode !== "enforce"/);
    assert.match(strictGate, /assertMobileAppAttestedWithMode\(request, uid, mode\)/);
  });

  it('keeps the between-units trail owner-scoped and outside fiscal point records', () => {
    assert.match(journeyLocation, /authorization: \{ kind: 'owner' \}/);
    assert.match(journeyLocation, /resourceScope: \{ kind: 'owner' \}/);
    assert.match(journeyLocation, /employeeId: actor\.decoded\.uid/);
    assert.match(journeyLocation, /assertOfficialMobileApp\(request, actor\.decoded\.uid\)/);
    assert.match(journeyLocation, /journeyLocationBatchSchema\.safeParse/);
    assert.match(journeyLocation, /export const POST = secureRoute/);
    assert.match(journeyLocationService, /JOURNEY_LOCATION_EVENTS = 'dp_journeyLocationEvents'/);
    assert.match(journeyLocationService, /JOURNEY_LOCATION_SESSIONS = 'dp_journeyLocationSessions'/);
    assert.match(journeyLocationService, /human_review_only/);
    assert.match(hrIndexes, /"collectionGroup": "dp_journeyLocationEvents", "fieldPath": "expiresAt", "ttl": true/);
    assert.match(hrIndexes, /"collectionGroup": "dp_journeyLocationSessions", "fieldPath": "expiresAt", "ttl": true/);
    assert.doesNotMatch(journeyLocationService, /repP_afd|ptrp_|receiptId|\bnsr\b/i);
  });

  it('restricts AFD export to the time manager and workspace', () => {
    assert.match(afd, /requireTimeManager\(request\)/);
    assert.match(afd, /resourceScope: \{ kind: 'workspace' \}/);
    assert.match(afd, /export const POST = secureRoute/);
    assert.match(afd, /private, no-store/);
  });

  it('serves receipts only to their owner, with a side-effect free GET and a separate retry', () => {
    assert.match(receipt, /ownerEnforcer\('dp-rep-p-receipt-read-v1', requireAuthenticatedUser\)/);
    assert.match(receipt, /ownerEnforcer\('dp-rep-p-receipt-retry-v1', requireUser\)/);
    assert.match(receipt, /authorization: \{ kind: 'owner' \}/);
    assert.match(receipt, /employeeId: actor\.decoded\.uid/);
    assert.match(receipt, /export const GET = secureRoute/);
    assert.match(receipt, /export const POST = secureRoute/);
    assert.match(receipt, /surface: \{ method: 'GET', path \}, effects: \{ mode: 'read', audit: 'none' \}/);
    assert.doesNotMatch(receipt.split('export const GET', 2)[1].split('export const POST', 1)[0], /retryOwnRepPReceipt/);
    assert.match(receipt, /private, no-store/);
  });

  it('exports a private receipt archive only to its owner and marks completeness in the response', () => {
    assert.match(receiptArchive, /await requireAuthenticatedUser\(request\)/);
    assert.match(receiptArchive, /authorization: \{ kind: 'owner' \}/);
    assert.match(receiptArchive, /employeeId: actor\.decoded\.uid/);
    assert.match(receiptArchive, /export const GET = secureRoute/);
    assert.match(receiptArchive, /effects: \{ mode: 'read', audit: 'none' \}/);
    assert.match(receiptArchive, /X-Coala-Archive-Complete/);
    assert.match(receiptArchive, /private, no-store/);
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
