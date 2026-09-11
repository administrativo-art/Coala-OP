import 'server-only';

import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';

type ImmutablePdfMetadata = Record<string, string>;

function isPreconditionFailure(error: unknown) {
  const candidate = error as { code?: number | string };
  return candidate?.code === 412 || candidate?.code === '412';
}

export async function saveImmutableVacationPdf(params: {
  storagePath: string;
  buffer: Buffer;
  metadata: ImmutablePdfMetadata;
}) {
  const file = getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(params.storagePath);
  const hashSha256 = createHash('sha256').update(params.buffer).digest('hex');
  try {
    await file.save(params.buffer, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'private, max-age=0, no-store',
        metadata: { ...params.metadata, hashSha256 },
      },
    });
  } catch (error) {
    if (!isPreconditionFailure(error)) throw error;
    const [existing] = await file.download();
    const existingHash = createHash('sha256').update(existing).digest('hex');
    if (existingHash !== hashSha256) throw error;
  }
  return { storagePath: params.storagePath, hashSha256 };
}
