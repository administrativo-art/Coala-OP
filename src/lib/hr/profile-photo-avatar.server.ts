import 'server-only';

import { randomUUID } from 'node:crypto';

import { getStorage } from 'firebase-admin/storage';

import { adminApp, dbAdmin } from '@/lib/firebase-admin';
import { firebaseClientConfig } from '@/lib/firebase-client-config';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import type { OnboardingDocument } from '@/types';

type AvatarSyncResult = {
  status: 'already_present' | 'not_available' | 'synced';
  avatarUrl: string | null;
  employeeDocumentId: string | null;
};

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firebaseDownloadUrl(bucket: string, path: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
}

function approvedProfilePhoto(documents: OnboardingDocument[]) {
  return documents.find(document =>
    document.status === 'approved'
    && (document.id === 'profile_photo' || document.documentTypeCode === 'PROFILE_PHOTO')
    && text(document.promotedDocumentId)
  ) ?? null;
}

export async function syncApprovedOnboardingPhotoToAvatar(params: {
  userId: string;
  onboardingId: string;
  documents: OnboardingDocument[];
}): Promise<AvatarSyncResult> {
  const userRef = dbAdmin.collection('users').doc(params.userId);
  const user = await userRef.get();
  const currentAvatarUrl = text(user.get('avatarUrl'));
  if (currentAvatarUrl) {
    return { status: 'already_present', avatarUrl: currentAvatarUrl, employeeDocumentId: null };
  }

  const photo = approvedProfilePhoto(params.documents);
  const employeeDocumentId = text(photo?.promotedDocumentId);
  if (!employeeDocumentId) {
    return { status: 'not_available', avatarUrl: null, employeeDocumentId: null };
  }

  const employeeDocument = await hrDbAdmin.collection('employeeDocuments').doc(employeeDocumentId).get();
  if (
    !employeeDocument.exists
    || employeeDocument.get('employeeId') !== params.userId
    || employeeDocument.get('documentTypeCode') !== 'PROFILE_PHOTO'
    || employeeDocument.get('status') !== 'validated'
    || employeeDocument.get('deletedAt')
  ) {
    throw new Error('A foto de identificação promovida não corresponde ao colaborador.');
  }

  const sourcePath = text(employeeDocument.get('storagePath'));
  const sourceMimeType = text(employeeDocument.get('mimeType'));
  if (!sourcePath || !sourceMimeType || !['image/jpeg', 'image/png'].includes(sourceMimeType)) {
    throw new Error('A foto de identificação promovida não possui uma imagem válida para o avatar.');
  }

  const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
  const destinationPath = `avatars/${params.userId}`;
  const destination = bucket.file(destinationPath);
  const [destinationExists] = await destination.exists();
  let downloadToken: string | null = null;

  if (destinationExists) {
    const [metadata] = await destination.getMetadata();
    downloadToken = text(metadata.metadata?.firebaseStorageDownloadTokens)?.split(',')[0]?.trim() || null;
    if (!downloadToken) {
      downloadToken = randomUUID();
      await destination.setMetadata({
        metadata: {
          ...(metadata.metadata ?? {}),
          firebaseStorageDownloadTokens: downloadToken,
          onboardingId: params.onboardingId,
          employeeDocumentId,
          avatarSource: 'onboarding_profile_photo',
        },
      });
    }
  } else {
    const source = bucket.file(sourcePath);
    const [sourceExists] = await source.exists();
    if (!sourceExists) throw new Error('A foto de identificação arquivada não foi encontrada no armazenamento.');
    const [contents] = await source.download();
    downloadToken = randomUUID();
    await destination.save(contents, {
      resumable: false,
      metadata: {
        contentType: sourceMimeType,
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          onboardingId: params.onboardingId,
          employeeDocumentId,
          avatarSource: 'onboarding_profile_photo',
        },
      },
    });
  }

  const avatarUrl = firebaseDownloadUrl(firebaseClientConfig.storageBucket, destinationPath, downloadToken);
  const now = new Date().toISOString();
  await userRef.set({
    avatarUrl,
    avatarSource: 'onboarding_profile_photo',
    avatarSourceDocumentId: employeeDocumentId,
    avatarUpdatedAt: now,
    updatedAt: now,
  }, { merge: true });

  return { status: 'synced', avatarUrl, employeeDocumentId };
}
