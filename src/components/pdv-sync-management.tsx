"use client";

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { functions } from '@/lib/firebase';
import { useKiosks } from '@/hooks/use-kiosks';
import { Field, fieldInputClass } from '@/components/patterns/field';
import { Segmented } from '@/components/patterns/segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status-pill';
import { resolvePdvFilialId } from '@/lib/kiosk-identifiers';
import {
  SYNC_PRESETS,
  formatBRL,
  logHasIssue,
  summarizeSyncLogs,
  syncPresetRange,
  syncRangeDays,
  validateSyncRange,
  type SyncLog,
} from '@/lib/pdv-sync-view';
import { cn } from '@/lib/utils';

type LogFilter = 'all' | 'issues';

function statusOf(log: SyncLog): { variant: StatusPillVariant; label: string } {
  if (log.status === 'pending') return { variant: 'neutral', label: 'Na fila' };
  if (log.status === 'loading') return { variant: 'info', label: 'Processando' };
  if (log.status === 'error') return { variant: 'danger', label: 'Falha' };
  return log.warnings?.length ? { variant: 'warn', label: 'Alerta' } : { variant: 'ok', label: 'Concluído' };
}

function SyncLogRow({ log }: { log: SyncLog }) {
  const status = statusOf(log);
  const d = log.diagnostics;
  return (
    <li className="grid grid-cols-[96px_44px_minmax(0,1fr)_auto] items-start gap-3 border-b border-ds-divider px-4 py-2.5 last:border-b-0">
      <span><StatusPill variant={status.variant}>{status.label}</StatusPill></span>
      <span className="pt-0.5 font-ds-mono text-xs text-ds-ink-muted">{format(new Date(`${log.date}T12:00:00Z`), 'dd/MM')}</span>
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-[13px] font-bold">{log.kioskName}</p>
        {log.status === 'success' && d ? (
          <p className="text-xs text-ds-ink-muted">
            {d.couponsReceived} cupons · {d.itemsMapped} itens mapeados{d.itemsUnmapped > 0 ? ` · ${d.itemsUnmapped} sem ficha técnica` : ''}
          </p>
        ) : null}
        {log.warnings?.map((warning) => (
          <p key={warning} className="text-xs font-semibold text-ds-warn">{warning}</p>
        ))}
        {log.status === 'success' && d && log.warnings?.length && d.unmappedSkus.length > 0 ? (
          <p className="text-xs text-ds-ink-muted">
            SKUs sem ficha: {d.unmappedSkus.slice(0, 3).map((sku) => sku.sku).join(', ')}
            {d.unmappedSkus.length > 3 ? ` e mais ${d.unmappedSkus.length - 3}` : ''}
          </p>
        ) : null}
        {log.status === 'error' ? (
          <p className="text-xs font-semibold text-ds-danger">
            {log.errorCode ? `(${log.errorCode}) ` : ''}{log.errorMessage ?? 'Falha ao sincronizar este dia.'}
          </p>
        ) : null}
      </div>
      <span className="pt-0.5 text-right font-ds-mono text-[13px] font-bold">
        {log.status === 'success' ? formatBRL(log.revenue ?? 0) : ''}
      </span>
    </li>
  );
}

export function PdvSyncManagement() {
  const { kiosks } = useKiosks();

  const [selectedKioskId, setSelectedKioskId] = useState<string>('all');
  const [startDate, setStartDate] = useState(() => syncPresetRange('week', new Date()).start);
  const [endDate, setEndDate] = useState(() => syncPresetRange('week', new Date()).end);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [logFilter, setLogFilter] = useState<LogFilter>('all');

  const resolvedKiosks = kiosks.map((k) => ({ ...k, pdvFilialId: resolvePdvFilialId(k) }));
  const linkedKiosks = resolvedKiosks.filter((k) => !!k.pdvFilialId);
  const targetKiosks = selectedKioskId === 'all' ? linkedKiosks : linkedKiosks.filter((k) => k.id === selectedKioskId);
  const previewRangeError = validateSyncRange(startDate, endDate);
  const operationCount = previewRangeError ? 0 : targetKiosks.length * syncRangeDays(startDate, endDate).length;

  const applyPreset = (id: (typeof SYNC_PRESETS)[number]['id']) => {
    const range = syncPresetRange(id, new Date());
    setStartDate(range.start);
    setEndDate(range.end);
    setRangeError(null);
  };

  async function startSync() {
    const invalid = validateSyncRange(startDate, endDate);
    setRangeError(invalid);
    setStartError(null);
    if (invalid) return;

    if (targetKiosks.length === 0) {
      setStartError('Nenhum quiosque configurado com ID do PDV Legal. Vincule a filial na aba Unidades.');
      return;
    }

    const days = syncRangeDays(startDate, endDate);
    const totalOperations = targetKiosks.length * days.length;

    setIsSyncing(true);
    setProgress(0);
    setLogFilter('all');

    const newLogs: SyncLog[] = [];
    targetKiosks.forEach((k) => {
      days.forEach((d) => {
        newLogs.push({ date: format(d, 'yyyy-MM-dd'), kioskName: k.name, status: 'pending' });
      });
    });
    setLogs(newLogs);

    const syncFn = httpsCallable(functions, 'syncGoalsForRange');
    let completed = 0;

    // Processamento sequencial por quiosque para não estourar a API do PDV Legal
    for (const kiosk of targetKiosks) {
      // Blocos de 7 dias evitam timeouts longos na Cloud Function
      const chunks = [];
      for (let i = 0; i < days.length; i += 7) {
        chunks.push(days.slice(i, i + 7));
      }

      for (const chunk of chunks) {
        const chunkStart = format(chunk[0], 'yyyy-MM-dd');
        const chunkEnd = format(chunk[chunk.length - 1], 'yyyy-MM-dd');

        try {
          setLogs((prev) =>
            prev.map((l) =>
              l.kioskName === kiosk.name && chunk.some((d) => format(d, 'yyyy-MM-dd') === l.date)
                ? { ...l, status: 'loading' }
                : l
            )
          );

          const result = (await syncFn({
            kioskId: kiosk.id,
            startDate: chunkStart,
            endDate: chunkEnd,
          })) as any;

          const resultsData = result.data.results || [];

          setLogs((prev) =>
            prev.map((l) => {
              const resMatch = resultsData.find((r: any) => r.date === l.date && l.kioskName === kiosk.name);
              if (resMatch) {
                const hasWarnings = Array.isArray(resMatch.warnings) && resMatch.warnings.length > 0;
                return {
                  ...l,
                  status: resMatch.error ? 'error' : 'success',
                  revenue: resMatch.revenue,
                  errorMessage: resMatch.error,
                  errorCode: resMatch.errorCode,
                  diagnostics: resMatch.diagnostics,
                  warnings: hasWarnings ? resMatch.warnings : undefined,
                };
              }
              return l;
            })
          );

          completed += chunk.length;
          setProgress(Math.round((completed / totalOperations) * 100));
        } catch (e: any) {
          console.error(`Erro no chunk ${chunkStart}-${chunkEnd}:`, e);
          setLogs((prev) =>
            prev.map((l) =>
              l.kioskName === kiosk.name && chunk.some((d) => format(d, 'yyyy-MM-dd') === l.date)
                ? { ...l, status: 'error', errorMessage: e.message }
                : l
            )
          );
          completed += chunk.length;
          setProgress(Math.round((completed / totalOperations) * 100));
        }
      }
    }

    setIsSyncing(false);
  }

  const summary = summarizeSyncLogs(logs);
  const visibleLogs = (logFilter === 'issues' ? logs.filter(logHasIssue) : logs).slice().reverse();
  const issueCount = logs.filter(logHasIssue).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      <section className="space-y-5 self-start rounded-ds-card-lg border border-ds-border bg-ds-warm p-6">
        <header>
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Reprocessar PDV Legal</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em]">Parâmetros</h2>
          <p className="mt-1 text-[13px] text-ds-ink-muted">
            Atualiza faturamento, metas e estoque a partir dos cupons do período.
          </p>
        </header>

        <Field label="Quiosque" htmlFor="sync-kiosk">
          <Select value={selectedKioskId} onValueChange={setSelectedKioskId} disabled={isSyncing}>
            <SelectTrigger id="sync-kiosk" className={fieldInputClass}>
              <SelectValue placeholder="Selecione o quiosque" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os quiosques</SelectItem>
              {linkedKiosks.map((k) => (
                <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Período" error={rangeError}>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label="Data inicial"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setRangeError(null); }}
              disabled={isSyncing}
              aria-invalid={!!rangeError}
              className={fieldInputClass}
            />
            <Input
              type="date"
              aria-label="Data final"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setRangeError(null); }}
              disabled={isSyncing}
              aria-invalid={!!rangeError}
              className={fieldInputClass}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {SYNC_PRESETS.map((preset) => (
              <Button key={preset.id} type="button" variant="ds-secondary" size="xs" onClick={() => applyPreset(preset.id)} disabled={isSyncing}>
                {preset.label(new Date())}
              </Button>
            ))}
          </div>
        </Field>

        <p className="rounded-ds-btn bg-ds-muted px-3.5 py-2.5 text-xs text-ds-ink-2">
          {operationCount > 0
            ? <>Serão processadas <strong className="font-extrabold">{operationCount}</strong> operações ({targetKiosks.length} {targetKiosks.length === 1 ? 'quiosque' : 'quiosques'} × {operationCount / targetKiosks.length} dias), em blocos de 7 dias por quiosque.</>
            : 'Escolha quiosque e período para ver quantas operações serão processadas.'}
        </p>

        {startError ? (
          <p role="alert" className="rounded-ds-btn border border-ds-alert-border bg-ds-alert-bg px-3.5 py-[11px] text-[12.5px] leading-normal text-ds-alert-ink">
            {startError}
          </p>
        ) : null}

        <Button type="button" variant="primary-page" size="xl" className="w-full" loading={isSyncing} loadingLabel={`Sincronizando… ${progress}%`} onClick={() => void startSync()}>
          Iniciar sincronização
        </Button>
      </section>

      <section className="rounded-ds-card-lg border border-ds-border bg-ds-warm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ds-divider px-6 py-4">
          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Andamento</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em]">Resultado por dia</h2>
          </div>
          {logs.length > 0 ? (
            <Segmented<LogFilter>
              aria-label="Filtrar resultado"
              value={logFilter}
              onChange={setLogFilter}
              options={[
                { value: 'all', label: `Todos ${logs.length}` },
                { value: 'issues', label: `Com pendências ${issueCount}` },
              ]}
            />
          ) : null}
        </header>

        {logs.length === 0 ? (
          <div className="m-6 rounded-ds-card border border-dashed border-ds-border-input px-5 py-14 text-center">
            <p className="text-sm font-bold">Nenhuma sincronização nesta sessão.</p>
            <p className="mt-1 text-xs text-ds-ink-muted">Os resultados aparecem aqui enquanto são processados e não ficam guardados ao sair da página.</p>
          </div>
        ) : (
          <div className="space-y-4 p-6">
            <div className="space-y-1.5" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-xs font-bold text-ds-ink-2">
                <span>{isSyncing ? 'Processando' : 'Concluído'} · {summary.finished} de {logs.length} dias</span>
                <span className="font-ds-mono">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {summary.finished > 0 ? (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-ds-btn border px-3.5 py-2.5 text-xs',
                  summary.healthy ? 'border-ds-ok/25 bg-ds-ok-bg text-ds-ok' : 'border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink'
                )}
              >
                <strong className="font-extrabold">{summary.healthy ? 'Dados íntegros' : 'Verificar pendências'}</strong>
                <span>Faturamento <strong className="font-extrabold">{formatBRL(summary.revenue)}</strong></span>
                <span>{summary.coupons} cupons</span>
                <span>{summary.mapped} itens mapeados</span>
                {summary.unmapped > 0 ? <span className="font-bold">{summary.unmapped} sem ficha técnica</span> : null}
                {summary.errorDays > 0 ? <span className="font-bold text-ds-danger">{summary.errorDays} dia(s) com erro</span> : null}
                {summary.warnDays > 0 ? <span className="font-bold">{summary.warnDays} dia(s) com alerta</span> : null}
              </div>
            ) : null}

            <ScrollArea className="h-[26rem] rounded-ds-btn-lg border border-ds-border bg-ds-surface">
              {visibleLogs.length > 0 ? (
                <ul className="m-0 list-none p-0">
                  {visibleLogs.map((log, index) => (
                    <SyncLogRow key={`${log.kioskName}-${log.date}-${index}`} log={log} />
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-12 text-center text-sm text-ds-ink-muted">Nenhum dia com pendência até agora.</p>
              )}
            </ScrollArea>
          </div>
        )}
      </section>
    </div>
  );
}
