import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lease = readFileSync('src/features/dp/rep-p/journey-location-lease.server.ts', 'utf8');
const route = readFileSync('src/app/api/dp/time-recording/journey-location/lease/route.ts', 'utf8');
const events = readFileSync('src/features/dp/rep-p/journey-location.server.ts', 'utf8');
const android = readFileSync('apps/coala-one-android/app/src/main/java/com/coalaone/go/location/JourneyLocationLeaseStore.kt', 'utf8');
const queue = readFileSync('apps/coala-one-android/app/src/main/java/com/coalaone/go/location/JourneyLocationQueue.kt', 'utf8');
const access = readFileSync('src/features/dp/rep-p/location-access.server.ts', 'utf8');

test('lease depende de usuário, jornada e política ao vivo, nunca da classificação empresarial', () => {
  assert.match(lease, /context\.decoded\.uid/);
  assert.match(lease, /locationTrackingPolicy !== 'workday'/);
  assert.match(lease, /participantUserIds\.includes\(context\.decoded\.uid\)/);
  assert.match(lease, /shiftWindowContainsNow\(shift, now\)/);
  assert.doesNotMatch(lease, /mobileCorporateDevices|corporateDevice/);
});

test('lease é curta, token fica somente em hash e cada lote precisa validá-la', () => {
  assert.match(lease, /JOURNEY_LOCATION_LEASE_MINUTES = 20/);
  assert.match(lease, /tokenHash: tokenHash\(token\)/);
  assert.doesNotMatch(lease, /tokenHash: token[, }]/);
  assert.match(events, /validateOwnJourneyLocationLease/);
  assert.match(events, /leaseToken: parsed\.data\.leaseToken/);
  assert.match(lease, /snapshot\.get\('executionUnitId'\) !== input\.executionUnitId/);
  assert.match(events, /revokeOwnJourneyLocationLease/);
});

test('rota é exclusiva do aplicativo oficial e Android renova antes de expirar', () => {
  assert.match(route, /assertOfficialMobileApp/);
  assert.match(route, /authorization:live-shift-policy/);
  assert.match(android, /expiresAt\.isAfter\(Instant\.now\(\)\.plusSeconds\(90\)\)/);
});

test('revogação descarta a fila local e auditoria precede a geocodificação externa', () => {
  assert.match(queue, /DP_JOURNEY_LOCATION_POLICY_INACTIVE/);
  assert.match(queue, /DP_JOURNEY_LOCATION_JOURNEY_INACTIVE/);
  assert.match(queue, /DP_JOURNEY_LOCATION_SEQUENCE_INVALID/);
  assert.match(queue, /DP_JOURNEY_LOCATION_SESSION_INVALID/);
  assert.match(queue, /DP_JOURNEY_LOCATION_RATE_INVALID/);
  assert.match(queue, /repository\.api\.journeyLocation[\s\S]*?catch \(cause: Exception\)/);
  assert.match(queue, /discardSession\(uid, directory, first\.sessionId\)/);
  assert.match(queue, /controller\.stopFromServer\(first\.sessionId\)/);
  assert.match(queue, /event\.eventType == "stop"\) 0 else 15/);
  assert.match(queue, /cause is SerializationException \|\| cause is IllegalArgumentException \|\| cause is AEADBadTagException/);
  assert.match(queue, /return@withContext folder\(uid\)\.listFiles\(\)\?\.isNotEmpty\(\) == true/);
  assert.ok(access.indexOf('await audit.create') < access.indexOf('await deps.enrichAddresses'));
});
