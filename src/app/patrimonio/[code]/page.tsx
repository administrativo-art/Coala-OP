import { notFound } from 'next/navigation';
import { Box, CalendarClock, CircleDot, ClipboardList, ImageIcon, MapPin, Tag } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { dbAdmin } from '@/lib/firebase-admin';
import { WORKSPACE_ID } from '@/lib/workspace';
import type { Asset, AssetMovement, AssetStatus } from '@/types';
import { MovementSection, type MovementItem } from './movement-section';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<AssetStatus, string> = {
  ativo: 'Ativo',
  em_manutencao: 'Em manutenção',
  fora_de_uso: 'Fora de uso',
  extraviado: 'Extraviado',
  vendido: 'Vendido',
  descartado: 'Descartado',
  baixado: 'Baixado',
};

const STATUS_STYLE: Record<AssetStatus, string> = {
  ativo: 'bg-emerald-500 text-white hover:bg-emerald-500',
  em_manutencao: 'bg-amber-500 text-white hover:bg-amber-500',
  fora_de_uso: 'bg-rose-500 text-white hover:bg-rose-500',
  extraviado: 'bg-red-600 text-white hover:bg-red-600',
  vendido: 'bg-blue-600 text-white hover:bg-blue-600',
  descartado: 'bg-zinc-600 text-white hover:bg-zinc-600',
  baixado: 'bg-slate-500 text-white hover:bg-slate-500',
};

type PublicAsset = Pick<
  Asset,
  | 'id'
  | 'code'
  | 'name'
  | 'category'
  | 'subcategory'
  | 'brand'
  | 'model'
  | 'serialNumber'
  | 'assetTag'
  | 'description'
  | 'currentKioskId'
  | 'currentKioskName'
  | 'department'
  | 'exactLocation'
  | 'responsibleName'
  | 'inUse'
  | 'possessionStatus'
  | 'status'
  | 'imageUrl'
  | 'notes'
  | 'updatedAt'
>;

function formatDateTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Belem',
  }).format(date);
}

async function getAssetByCode(code: string): Promise<PublicAsset | null> {
  const normalizedCode = decodeURIComponent(code).trim().toUpperCase();
  if (!normalizedCode) return null;

  const snapshot = await dbAdmin
    .collection('assets')
    .where('code', '==', normalizedCode)
    .limit(1)
    .get();

  const doc = snapshot.docs[0];
  if (!doc) return null;

  const data = doc.data() as Asset & { workspaceId?: string };
  if (data.workspaceId !== WORKSPACE_ID) return null;

  return {
    id: doc.id,
    code: data.code,
    name: data.name,
    category: data.category,
    subcategory: data.subcategory,
    brand: data.brand,
    model: data.model,
    serialNumber: data.serialNumber,
    assetTag: data.assetTag,
    description: data.description,
    currentKioskId: data.currentKioskId,
    currentKioskName: data.currentKioskName,
    department: data.department,
    exactLocation: data.exactLocation,
    responsibleName: data.responsibleName,
    inUse: data.inUse,
    possessionStatus: data.possessionStatus,
    status: data.status,
    imageUrl: data.imageUrl,
    notes: data.notes,
    updatedAt: data.updatedAt,
  };
}

async function getKiosks() {
  const snap = await dbAdmin.collection('kiosks').get();
  return snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || d.id }));
}

async function getUsers() {
  const snap = await dbAdmin.collection('users').where('isActive', '!=', false).get();
  return snap.docs.map((d) => ({ id: d.id, username: (d.data().username as string) || d.id }));
}

async function getMovements(assetId: string): Promise<MovementItem[]> {
  const snap = await dbAdmin
    .collection('assetMovements')
    .where('assetId', '==', assetId)
    .get();

  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<AssetMovement>;
      return {
        id: d.id,
        type: data.type ?? '',
        username: data.username ?? '',
        toKioskName: data.toKioskName,
        fromKioskName: data.fromKioskName,
        notes: data.notes,
        occurredAt: data.occurredAt ?? '',
      };
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export default async function PublicAssetPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const [asset, kiosks, users] = await Promise.all([
    getAssetByCode(code),
    getKiosks(),
    getUsers(),
  ]);

  if (!asset) notFound();

  const movements = await getMovements(asset.id);

  const meta = [asset.brand, asset.model, asset.serialNumber].filter(Boolean).join(' · ');

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="relative flex aspect-[16/10] items-center justify-center bg-slate-100 sm:aspect-[16/7]">
            {asset.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.imageUrl} alt={asset.name} className="h-full w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-500">
                <ImageIcon className="h-12 w-12" />
                <span className="text-sm font-medium">Sem foto cadastrada</span>
              </div>
            )}
            <div className="absolute left-4 top-4 flex flex-wrap gap-2">
              <Badge className={STATUS_STYLE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
              <Badge variant="secondary" className="font-mono">{asset.code}</Badge>
            </div>
          </div>
          <div className="space-y-3 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-pink-600">Consulta de patrimônio</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{asset.name}</h1>
              {meta ? <p className="mt-1 text-sm text-slate-500">{meta}</p> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-sm text-slate-500"><MapPin className="h-4 w-4" />Unidade atual</div>
                <p className="mt-1 font-semibold">{asset.currentKioskName || asset.currentKioskId || '-'}</p>
                {asset.department || asset.exactLocation ? (
                  <p className="mt-1 text-xs text-slate-500">{[asset.department, asset.exactLocation].filter(Boolean).join(' · ')}</p>
                ) : null}
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-sm text-slate-500"><Tag className="h-4 w-4" />Categoria</div>
                <p className="mt-1 font-semibold">{asset.category || '-'}</p>
              </div>
            </div>
          </div>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5" />Identificação</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Info label="Código" value={asset.code} mono icon={<Box className="h-4 w-4" />} />
            <Info label="Status" value={STATUS_LABEL[asset.status]} icon={<CircleDot className="h-4 w-4" />} />
            <Info label="Marca" value={asset.brand || '-'} />
            <Info label="Modelo" value={asset.model || '-'} />
            <Info label="Número de série" value={asset.serialNumber || '-'} mono />
            <Info label="Responsável" value={asset.responsibleName || '-'} />
            <Info label="Em uso" value={asset.inUse === false ? 'Não' : 'Sim'} />
            <Info label="Última atualização" value={formatDateTime(asset.updatedAt)} icon={<CalendarClock className="h-4 w-4" />} />
          </CardContent>
        </Card>

        {asset.description || asset.notes ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Observações</CardTitle>
            </CardHeader>
            <CardContent>
              {asset.description ? <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{asset.description}</p> : null}
              {asset.notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{asset.notes}</p> : null}
            </CardContent>
          </Card>
        ) : null}

        <MovementSection
          assetId={asset.id}
          assetCode={asset.code}
          assetName={asset.name}
          responsibleName={asset.responsibleName}
          currentKioskId={asset.currentKioskId}
          currentKioskName={asset.currentKioskName}
          kiosks={kiosks}
          users={users}
          movements={movements}
        />
      </div>
    </main>
  );
}

function Info({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-slate-500">
        {icon}
        {label}
      </div>
      <p className={mono ? 'mt-1 font-mono text-sm font-semibold' : 'mt-1 text-sm font-semibold'}>{value}</p>
    </div>
  );
}
