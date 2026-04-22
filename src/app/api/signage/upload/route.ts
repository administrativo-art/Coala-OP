import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { getSignageAssetUrl, SIGNAGE_IMAGE_MAX_BYTES, SIGNAGE_STORAGE_BUCKET, SIGNAGE_VIDEO_MAX_BYTES } from '@/lib/signage';
import { assertSignageAccess } from '@/lib/signage-auth';

function sanitizeFileName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-');
}

function detectAsset(buffer: Buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { kind: 'image' as const, contentType: 'image/png' };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: 'image' as const, contentType: 'image/jpeg' };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { kind: 'image' as const, contentType: 'image/webp' };
  }

  const ftypIndex = buffer.indexOf(Buffer.from('ftyp'));
  if (ftypIndex >= 0 && ftypIndex <= 16) {
    return { kind: 'video' as const, contentType: 'video/mp4' };
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    await assertSignageAccess(req, 'manage');

    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo ausente.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedAsset = detectAsset(buffer);

    if (!detectedAsset) {
      return NextResponse.json({ error: 'Envie uma imagem ou vídeo válido.' }, { status: 400 });
    }

    if (detectedAsset.kind === 'image' && file.size > SIGNAGE_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: 'Imagem acima do limite de 2 MB.' }, { status: 400 });
    }

    if (detectedAsset.kind === 'video' && file.size > SIGNAGE_VIDEO_MAX_BYTES) {
      return NextResponse.json({ error: 'Vídeo acima do limite de 30 MB.' }, { status: 400 });
    }

    const objectPath = `signage/${Date.now()}-${sanitizeFileName(file.name)}`;
    const bucket = getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET);
    const bucketFile = bucket.file(objectPath);

    await bucketFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType: detectedAsset.contentType,
      },
    });

    return NextResponse.json({
      assetUrl: getSignageAssetUrl(objectPath),
      assetPath: objectPath,
      assetKind: detectedAsset.kind,
    });
  } catch (error) {
    console.error('[signage/upload][POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao enviar arquivo.' },
      { status: 400 }
    );
  }
}
