import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from 'firebase-admin/storage';

import { adminApp } from '@/lib/firebase-admin';
import { SIGNAGE_STORAGE_BUCKET } from '@/lib/signage';

export async function GET(_: NextRequest, { params }: { params: Promise<{ assetPath: string[] }> }) {
  const { assetPath } = await params;
  const objectPath = assetPath.join('/');

  if (!objectPath.startsWith('signage/')) {
    return NextResponse.json({ error: 'Asset inválido.' }, { status: 400 });
  }

  const bucket = getStorage(adminApp).bucket(SIGNAGE_STORAGE_BUCKET);
  const file = bucket.file(objectPath);
  const [exists] = await file.exists();

  if (!exists) {
    return NextResponse.json({ error: 'Asset não encontrado.' }, { status: 404 });
  }

  const [metadata] = await file.getMetadata();
  const contentType = metadata.contentType ?? 'application/octet-stream';
  const size = Number(metadata.size ?? 0);
  const rangeHeader = _.headers.get('range');

  if (rangeHeader && contentType.startsWith('video/') && size > 0) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : Math.min(start + 1024 * 1024 - 1, size - 1);
    const end = Math.min(requestedEnd, size - 1);

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }

    const [buffer] = await file.download({ start, end });
    return new NextResponse(new Uint8Array(buffer), {
      status: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Type': contentType,
      },
    });
  }

  const [buffer] = await file.download();
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      'Content-Length': size > 0 ? String(size) : String(buffer.length),
      'Content-Type': contentType,
    },
  });
}
