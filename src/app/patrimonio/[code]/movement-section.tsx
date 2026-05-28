'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ClockIcon, History, MoveRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createRetiradaMovement } from './actions';

type KioskOption = { id: string; name: string };
type UserOption = { id: string; username: string };

export type MovementItem = {
  id: string;
  type: string;
  username: string;
  toKioskName?: string;
  fromKioskName?: string;
  notes?: string;
  occurredAt: string;
};

type Props = {
  assetId: string;
  assetCode: string;
  assetName: string;
  responsibleName?: string;
  currentKioskId?: string;
  currentKioskName?: string;
  kiosks: KioskOption[];
  users: UserOption[];
  movements: MovementItem[];
};

const MOVEMENT_LABELS: Record<string, string> = {
  CRIACAO: 'Cadastro',
  EDICAO: 'Edição',
  TRANSFERENCIA: 'Transferência',
  ALTERACAO_STATUS: 'Alteração de status',
  BAIXA: 'Baixa',
  ETIQUETA_REIMPRESSA: 'Etiqueta reimpressa',
  RETIRADA: 'Retirada',
};

function formatDateTime(iso: string) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Belem',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type ToggleType = 'cadastrado' | 'externo';

function ToggleBar({ value, onChange }: { value: ToggleType; onChange: (v: ToggleType) => void }) {
  return (
    <div className="flex rounded-md border border-slate-200 overflow-hidden w-fit text-sm">
      <button
        type="button"
        onClick={() => onChange('cadastrado')}
        className={`px-3 py-1.5 transition-colors ${value === 'cadastrado' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
      >
        Cadastrado
      </button>
      <button
        type="button"
        onClick={() => onChange('externo')}
        className={`px-3 py-1.5 border-l border-slate-200 transition-colors ${value === 'externo' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
      >
        Não cadastrado
      </button>
    </div>
  );
}

export function MovementSection({
  assetId,
  assetCode,
  assetName,
  responsibleName,
  currentKioskId,
  currentKioskName,
  kiosks,
  users,
  movements,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [withdrawerType, setWithdrawerType] = useState<ToggleType>('cadastrado');
  const [withdrawerUserId, setWithdrawerUserId] = useState('');
  const [withdrawerFree, setWithdrawerFree] = useState('');

  const [destType, setDestType] = useState<ToggleType>('cadastrado');
  const [destKioskId, setDestKioskId] = useState('');
  const [destFree, setDestFree] = useState('');

  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function reset() {
    setWithdrawerUserId('');
    setWithdrawerFree('');
    setDestKioskId('');
    setDestFree('');
    setNotes('');
  }

  function handleWithdrawerTypeChange(v: ToggleType) {
    setWithdrawerType(v);
    setWithdrawerUserId('');
    setWithdrawerFree('');
  }

  function handleDestTypeChange(v: ToggleType) {
    setDestType(v);
    setDestKioskId('');
    setDestFree('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const withdrawerName =
      withdrawerType === 'cadastrado'
        ? users.find((u) => u.id === withdrawerUserId)?.username ?? ''
        : withdrawerFree;

    const destinationName =
      destType === 'cadastrado'
        ? kiosks.find((k) => k.id === destKioskId)?.name ?? ''
        : destFree;

    startTransition(async () => {
      const result = await createRetiradaMovement(
        assetId,
        assetCode,
        assetName,
        currentKioskId,
        currentKioskName,
        {
          withdrawerName,
          withdrawerUserId: withdrawerType === 'cadastrado' ? withdrawerUserId : undefined,
          destinationName,
          destinationKioskId: destType === 'cadastrado' ? destKioskId : undefined,
          notes,
        },
      );

      if (result.success) {
        setFeedback({ type: 'success', message: 'Movimentação registrada com sucesso.' });
        reset();
        router.refresh();
      } else {
        setFeedback({ type: 'error', message: result.error ?? 'Erro ao registrar.' });
      }
    });
  }

  return (
    <>
      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MoveRight className="h-5 w-5" />
            Registrar movimentação
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Responsável atual */}
            <div className="rounded-md border bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Responsável atual</p>
              <p className="mt-1 text-sm font-semibold">{responsibleName || '—'}</p>
            </div>

            {/* Quem está retirando */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Quem está retirando</p>
              <ToggleBar value={withdrawerType} onChange={handleWithdrawerTypeChange} />
              {withdrawerType === 'cadastrado' ? (
                <Select value={withdrawerUserId} onValueChange={setWithdrawerUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um colaborador" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Nome de quem está retirando"
                  value={withdrawerFree}
                  onChange={(e) => setWithdrawerFree(e.target.value)}
                />
              )}
            </div>

            {/* Para onde vai */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Para onde vai</p>
              <ToggleBar value={destType} onChange={handleDestTypeChange} />
              {destType === 'cadastrado' ? (
                <Select value={destKioskId} onValueChange={setDestKioskId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {kiosks.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Destino"
                  value={destFree}
                  onChange={(e) => setDestFree(e.target.value)}
                />
              )}
            </div>

            {/* Observações */}
            <Textarea
              placeholder="Observações (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />

            {feedback && (
              <p className={`text-sm ${feedback.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                {feedback.message}
              </p>
            )}

            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? 'Registrando...' : 'Registrar'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* History */}
      {movements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5" />
              Histórico de movimentações
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {movements.map((m) => (
                <div key={m.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100">
                    <ClockIcon className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {MOVEMENT_LABELS[m.type] ?? m.type}
                      </span>
                      <span className="shrink-0 text-xs text-slate-400">{formatDateTime(m.occurredAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <span>{m.username}</span>
                      {m.toKioskName && (
                        <>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span>{m.toKioskName}</span>
                        </>
                      )}
                    </div>
                    {m.notes && <p className="mt-1 text-xs text-slate-400">{m.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
