import { randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { removeDeletedUberFinancialCandidate, synchronizeUberFinancialCandidate } from './repository.js';
import { syncUberTripsFromSftp } from './sync.js';

const uberSftpEnabled = defineBoolean('UBER_SFTP_ENABLED', { default: false });
const uberSftpUsername = defineString('UBER_SFTP_USERNAME', { default: '' });
const uberSftpHostFingerprint = defineString('UBER_SFTP_HOST_FINGERPRINT_SHA256', { default: '' });
const uberSftpVpcConnector = defineString('UBER_SFTP_VPC_CONNECTOR');
const uberSftpPrivateKey = defineSecret('UBER_SFTP_PRIVATE_KEY');

function reportCandidateError(
  operation: string,
  entityKind: 'expense' | 'transaction',
  entityId: string,
  error: unknown,
) {
  const eventId = randomUUID();
  const errorCode = error instanceof Error
    ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 160)
    : 'UNKNOWN_ERROR';
  logger.error('Uber reconciliation candidate failed.', {
    source: 'uber-reconciliation',
    operation,
    entityKind,
    entityId,
    eventId,
    errorCode,
  });
  return eventId;
}

async function handleFinancialDocument(
  entityKind: 'expense' | 'transaction',
  entityId: string,
  data: Record<string, unknown> | undefined,
) {
  if (!data) return;
  try {
    await synchronizeUberFinancialCandidate(entityKind, entityId, data);
  } catch (error) {
    const eventId = reportCandidateError('synchronize-candidate', entityKind, entityId, error);
    throw new Error(`UBER_CANDIDATE_SYNC_FAILED:${eventId}`);
  }
}

async function handleDeletedFinancialDocument(
  entityKind: 'expense' | 'transaction',
  entityId: string,
  data: Record<string, unknown>,
) {
  try {
    await removeDeletedUberFinancialCandidate(entityKind, entityId, data);
  } catch (error) {
    const eventId = reportCandidateError('remove-deleted-candidate', entityKind, entityId, error);
    throw new Error(`UBER_CANDIDATE_DELETE_FAILED:${eventId}`);
  }
}

export const uberSftpDailySync = onSchedule({
  schedule: '30 12 * * *',
  timeZone: 'America/Belem',
  region: 'southamerica-east1',
  retryCount: 2,
  timeoutSeconds: 540,
  memory: '512MiB',
  maxInstances: 1,
  vpcConnector: uberSftpVpcConnector,
  vpcConnectorEgressSettings: 'ALL_TRAFFIC',
  secrets: [uberSftpPrivateKey],
}, async () => {
  if (!uberSftpEnabled.value()) {
    logger.info('Uber SFTP integration disabled by configuration.', { source: 'uber-sftp' });
    return;
  }
  await syncUberTripsFromSftp({
    username: uberSftpUsername.value(),
    privateKey: uberSftpPrivateKey.value(),
    hostFingerprintSha256: uberSftpHostFingerprint.value(),
  });
});

export const uberExpenseCandidateWritten = onDocumentWritten({
  document: 'expenses/{expenseId}',
  database: 'coala-financeiro',
  region: 'southamerica-east1',
  retry: true,
  maxInstances: 10,
}, async (event) => {
  if (event.data?.after.exists) {
    await handleFinancialDocument('expense', event.params.expenseId, event.data.after.data());
    return;
  }
  if (event.data?.before.exists) {
    const beforeData = event.data.before.data();
    if (beforeData) await handleDeletedFinancialDocument('expense', event.params.expenseId, beforeData);
  }
});

export const uberTransactionCandidateWritten = onDocumentWritten({
  document: 'transactions/{transactionId}',
  database: 'coala-financeiro',
  region: 'southamerica-east1',
  retry: true,
  maxInstances: 10,
}, async (event) => {
  if (event.data?.after.exists) {
    await handleFinancialDocument('transaction', event.params.transactionId, event.data.after.data());
    return;
  }
  if (event.data?.before.exists) {
    const beforeData = event.data.before.data();
    if (beforeData) await handleDeletedFinancialDocument('transaction', event.params.transactionId, beforeData);
  }
});
