import 'server-only';

import { createHash } from 'node:crypto';

import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { createStoredZip } from './receipt-archive';

export type FiscalArtifactStore = Readonly<{
  put(path: string, bytes: Buffer, contentType: string, sha256: string, retainUntilTime: string): Promise<{
    bucket: string; generation: string; retainUntilTime: string; retentionMode: 'Locked';
  }>;
}>;

const fiscalBucketName = () => {
  const value = process.env.REP_P_FISCAL_STORAGE_BUCKET?.trim();
  if (!value) throw new Error('REP_P_FISCAL_STORAGE_BUCKET não configurado.');
  return value;
};

const bucket = () => getStorage(adminApp).bucket(fiscalBucketName());
let retentionCapability: Promise<void> | undefined;

async function assertObjectRetentionEnabled() {
  retentionCapability ??= bucket().getMetadata().then(([metadata]) => {
    if (metadata.objectRetention?.mode !== 'Enabled') {
      throw new Error('O bucket fiscal não possui retenção por objeto habilitada.');
    }
  }).catch((cause) => {
    retentionCapability = undefined;
    throw cause;
  });
  await retentionCapability;
}

export const fiscalArtifactStore: FiscalArtifactStore = Object.freeze({
  async put(path, bytes, contentType, sha256, retainUntilTime) {
    await assertObjectRetentionEnabled();
    const file = bucket().file(path);
    await file.save(bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType, cacheControl: 'private, max-age=0, no-store',
        retention: { mode: 'Locked', retainUntilTime },
        metadata: { sha256, retentionClass: 'time_fiscal_export', retentionYears: '20' } },
    });
    const [metadata] = await file.getMetadata();
    const actualRetainUntilTime = metadata.retention?.retainUntilTime;
    if (metadata.retention?.mode !== 'Locked' || !actualRetainUntilTime
      || Date.parse(actualRetainUntilTime) < Date.parse(retainUntilTime)) {
      await file.delete({ ifGenerationMatch: String(metadata.generation) }).catch(() => undefined);
      throw new Error('O arquivo fiscal não recebeu a retenção imutável esperada.');
    }
    return { bucket: fiscalBucketName(), generation: String(metadata.generation),
      retainUntilTime: actualRetainUntilTime, retentionMode: 'Locked' };
  },
});

function safeSegment(value: string) {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new TypeError('Identificador incompatível com o arquivo fiscal.');
  }
  return value;
}

function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }

export type PersistedFiscalArtifacts = Readonly<{
  bundle: { storageBucket: string; storagePath: string; generation: string; sha256: string; size: number;
    retainUntilTime: string; retentionMode: 'Locked' };
  content: { filename: string; sha256: string; size: number };
  signature: { filename: string; sha256: string; size: number };
  retentionClass: 'time_fiscal_export';
  retentionYears: 20;
}>;

/** Trava um único ZIP com os dois arquivos exatos; não existe estado persistido com apenas metade do par. */
export async function persistFiscalArtifactPair(params: {
  store: FiscalArtifactStore;
  kind: 'afd' | 'aej';
  workspaceId: string;
  establishmentId: string;
  exportId: string;
  filename: string;
  content: Buffer;
  expectedSha256: string;
  signatureFilename: string;
  signature: Buffer;
}) {
  const contentSha256 = sha256(params.content);
  if (contentSha256 !== params.expectedSha256) throw new TypeError('Hash do arquivo fiscal divergente antes do arquivamento.');
  const signatureSha256 = sha256(params.signature);
  const base = ['time-recording', 'fiscal-exports', safeSegment(params.workspaceId), params.kind,
    safeSegment(params.establishmentId), safeSegment(params.exportId)].join('/');
  const contentFilename = safeSegment(params.filename);
  const signatureFilename = safeSegment(params.signatureFilename);
  const manifest = Buffer.from(`${JSON.stringify({ schemaVersion: 1, kind: params.kind,
    content: { filename: contentFilename, sha256: contentSha256, size: params.content.byteLength },
    signature: { filename: signatureFilename, sha256: signatureSha256, size: params.signature.byteLength } }, null, 2)}\n`, 'utf8');
  const bundle = createStoredZip([
    { name: 'manifesto.json', bytes: manifest },
    { name: contentFilename, bytes: params.content },
    { name: signatureFilename, bytes: params.signature },
  ]);
  const bundleSha256 = sha256(bundle);
  const storagePath = `${base}/pacote-fiscal-${params.kind}.zip`;
  const retention = new Date();
  retention.setUTCFullYear(retention.getUTCFullYear() + 20);
  const retainUntilTime = retention.toISOString();
  const stored = await params.store.put(storagePath, bundle, 'application/zip', bundleSha256, retainUntilTime);
  return { bundle: { storageBucket: stored.bucket, storagePath, generation: stored.generation, sha256: bundleSha256,
    size: bundle.byteLength, retainUntilTime: stored.retainUntilTime, retentionMode: stored.retentionMode },
    content: { filename: contentFilename, sha256: contentSha256, size: params.content.byteLength },
    signature: { filename: signatureFilename, sha256: signatureSha256, size: params.signature.byteLength },
    retentionClass: 'time_fiscal_export' as const, retentionYears: 20 as const };
}
