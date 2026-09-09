import { createHash, randomUUID } from 'node:crypto';
import * as logger from 'firebase-functions/logger';
import SftpClient from 'ssh2-sftp-client';
import { normalizeSha256HostFingerprint, parseUberTripCsv, uberDailyFileDate } from './domain.js';
import {
  claimUberImport,
  completeUberImport,
  failUberImport,
  reconcilePreviouslyLinkedUberCandidates,
  reconcileUberCandidatesForTripKeys,
  uberImportDocumentId,
  upsertUberTrip,
  type UberImportSource,
} from './repository.js';

const UBER_SFTP_HOST = 'sftp.uber.com';
const UBER_SFTP_PORT = 2222;
const UBER_TRIPS_DIRECTORY = '/from_uber/trips';
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_RUN = 10;
const FILE_LOOKBACK_DAYS = 35;

export type UberSftpConfiguration = {
  username: string;
  privateKey: string;
  privateKeyPassphrase: string;
  hostFingerprintSha256: string;
};

export type UberSftpSyncResult = {
  listedFiles: number;
  eligibleFiles: number;
  processedFiles: number;
  skippedFiles: number;
  importedTrips: number;
  reconciledCandidates: number;
};

type DailyFile = {
  name: string;
  remotePath: string;
  fileDate: string;
  size: number;
  modifyTime: number;
};

function required(value: string, code: string) {
  const resolved = value.trim();
  if (!resolved) throw new Error(code);
  return resolved;
}

function earliestEligibleDate(now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - FILE_LOOKBACK_DAYS);
  return date.toISOString().slice(0, 10);
}

function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 180);
}

function reportUnexpectedError(operation: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const eventId = randomUUID();
  logger.error('Uber SFTP operation failed.', {
    source: 'uber-sftp',
    operation,
    eventId,
    error: sanitizedError(error),
    ...metadata,
  });
  return eventId;
}

function checksumSha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fileSource(file: DailyFile, checksum: string): UberImportSource {
  return {
    id: uberImportDocumentId(file.remotePath),
    fileName: file.name,
    remotePath: file.remotePath,
    remoteSize: file.size,
    remoteModifiedAt: file.modifyTime,
    checksumSha256: checksum,
  };
}

export async function syncUberTripsFromSftp(configuration: UberSftpConfiguration): Promise<UberSftpSyncResult> {
  const username = required(configuration.username, 'UBER_SFTP_USERNAME_REQUIRED');
  const privateKey = required(configuration.privateKey, 'UBER_SFTP_PRIVATE_KEY_REQUIRED');
  const expectedHostFingerprint = normalizeSha256HostFingerprint(
    required(configuration.hostFingerprintSha256, 'UBER_SFTP_HOST_FINGERPRINT_REQUIRED'),
  );
  const client = new SftpClient('coala-one-uber-sftp');
  const result: UberSftpSyncResult = {
    listedFiles: 0,
    eligibleFiles: 0,
    processedFiles: 0,
    skippedFiles: 0,
    importedTrips: 0,
    reconciledCandidates: 0,
  };

  try {
    await client.connect({
      host: UBER_SFTP_HOST,
      port: UBER_SFTP_PORT,
      username,
      privateKey,
      ...(configuration.privateKeyPassphrase ? { passphrase: configuration.privateKeyPassphrase } : {}),
      forceIPv4: true,
      readyTimeout: 30_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: (fingerprint: string) => fingerprint.toLocaleLowerCase('en-US') === expectedHostFingerprint,
    });
    const listed = await client.list(UBER_TRIPS_DIRECTORY);
    result.listedFiles = listed.length;
    const earliestDate = earliestEligibleDate();
    const eligible = listed.flatMap((file): DailyFile[] => {
      if (file.type !== '-' || file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) return [];
      const fileDate = uberDailyFileDate(file.name);
      if (!fileDate || fileDate < earliestDate) return [];
      return [{
        name: file.name,
        remotePath: `${UBER_TRIPS_DIRECTORY}/${file.name}`,
        fileDate,
        size: file.size,
        modifyTime: file.modifyTime,
      }];
    }).sort((left, right) => left.fileDate.localeCompare(right.fileDate))
      .slice(-MAX_FILES_PER_RUN);
    result.eligibleFiles = eligible.length;

    const primaryMatchKeys: string[] = [];
    const previouslyLinkedEntities: Array<{ entityKind: 'expense' | 'transaction'; entityId: string }> = [];
    for (const file of eligible) {
      const importId = uberImportDocumentId(file.remotePath);
      const claimed = await claimUberImport({
        id: importId,
        fileName: file.name,
        remotePath: file.remotePath,
        remoteSize: file.size,
        remoteModifiedAt: file.modifyTime,
      });
      if (!claimed) {
        result.skippedFiles += 1;
        continue;
      }
      try {
        const downloaded = await client.get(file.remotePath);
        const buffer = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(String(downloaded));
        if (buffer.length === 0 || buffer.length > MAX_FILE_SIZE_BYTES) throw new Error('UBER_SFTP_FILE_SIZE_INVALID');
        const source = fileSource(file, checksumSha256(buffer));
        const trips = parseUberTripCsv(buffer);
        for (const trip of trips) {
          const upserted = await upsertUberTrip(trip, source);
          if (upserted.primaryMatchKey) primaryMatchKeys.push(upserted.primaryMatchKey);
          previouslyLinkedEntities.push(...upserted.previouslyLinkedEntities);
        }
        const rowCount = trips.reduce((sum, trip) => sum + trip.transactions.length, 0);
        await completeUberImport(source, { rowCount, tripCount: trips.length });
        result.processedFiles += 1;
        result.importedTrips += trips.length;
      } catch (error) {
        const eventId = reportUnexpectedError('process-file', error, { importId, fileName: file.name });
        await failUberImport(importId, eventId);
        throw new Error(`UBER_SFTP_FILE_PROCESSING_FAILED:${eventId}`);
      }
    }

    result.reconciledCandidates += await reconcilePreviouslyLinkedUberCandidates(previouslyLinkedEntities);
    result.reconciledCandidates += await reconcileUberCandidatesForTripKeys(primaryMatchKeys);
    logger.info('Uber SFTP sync completed.', { source: 'uber-sftp', operation: 'sync-completed', ...result });
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('UBER_SFTP_FILE_PROCESSING_FAILED:')) throw error;
    const eventId = reportUnexpectedError('sync', error);
    throw new Error(`UBER_SFTP_SYNC_FAILED:${eventId}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
