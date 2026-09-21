"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';
import { AlertTriangle, CalendarCheck2, ChevronLeft, Loader2 } from 'lucide-react';

import { useDP } from '@/components/dp-context';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { DPCalendar, DPVacationRecord } from '@/types';
import type { VacationCycle } from '@/lib/utils/vacation-logic';
import { vacationEntitlementDays } from '@/lib/dp-vacation-workflow';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const;

interface Props {
  employeeName: string;
  userId: string;
  cycle: VacationCycle;
  calendars: DPCalendar[];
  record?: DPVacationRecord;
  onBack: () => void;
}

function dateValue(value?: string | null) {
  return value ?? '';
}

export function DPVacationEditorPanel({
  employeeName,
  userId,
  cycle,
  calendars,
  record,
  onBack,
}: Props) {
  const { addVacation, updateVacation } = useDP();
  const { toast } = useToast();
  const [recordType, setRecordType] = useState<'gozo' | 'venda'>(record?.recordType ?? 'gozo');
  const [startDate, setStartDate] = useState(dateValue(record?.startDate));
  const [endDate, setEndDate] = useState(dateValue(record?.endDate));
  const [calendarId, setCalendarId] = useState(record?.calendarId ?? '');
  const [weeklyRestDay, setWeeklyRestDay] = useState(String(record?.weeklyRestDay ?? 0));
  const [unjustifiedAbsences, setUnjustifiedAbsences] = useState(String(record?.unjustifiedAbsences ?? 0));
  const [employeeAgreedToSplit, setEmployeeAgreedToSplit] = useState(record?.employeeAgreedToSplit ?? false);
  const [thirteenthAdvanceRequested, setThirteenthAdvanceRequested] = useState(record?.thirteenthAdvanceRequested ?? false);
  const [allowanceDays, setAllowanceDays] = useState(String(record?.recordType === 'venda' ? record.days : 10));
  const [allowanceRequestedAt, setAllowanceRequestedAt] = useState(dateValue(record?.allowanceRequestedAt));
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(record);
  const validRange = Boolean(startDate && endDate && endDate >= startDate);
  const enjoymentDays = validRange
    ? differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1
    : 0;
  const returnDate = validRange ? format(addDays(parseISO(endDate), 1), 'yyyy-MM-dd') : '';
  const noticeLeadDays = startDate
    ? differenceInCalendarDays(parseISO(startDate), startOfDay(new Date()))
    : null;
  const shortNotice = noticeLeadDays !== null && noticeLeadDays < 30;
  const selectedCalendar = calendars.find(calendar => calendar.id === calendarId);
  const entitlementDays = vacationEntitlementDays(Number(unjustifiedAbsences) || 0);
  useEffect(() => {
    if (recordType !== 'gozo' || calendarId) return;
    const year = Number(startDate.slice(0, 4));
    const suggested = calendars.find(calendar => calendar.year === year) ?? calendars[0];
    if (suggested) setCalendarId(suggested.id);
  }, [calendarId, calendars, recordType, startDate]);

  const saveEnabled = useMemo(() => {
    if (saving) return false;
    if (recordType === 'gozo') return validRange && Boolean(calendarId) && enjoymentDays >= 1 && enjoymentDays <= 30;
    const days = Number(allowanceDays);
    return Number.isInteger(days) && days >= 1 && days <= 10 && Boolean(allowanceRequestedAt);
  }, [allowanceDays, allowanceRequestedAt, calendarId, enjoymentDays, recordType, saving, validRange]);

  async function save() {
    if (!saveEnabled) return;
    setSaving(true);
    try {
      const common = {
        userId,
        cycleId: cycle.id,
        recordType,
        status: record?.status ?? 'PENDING' as const,
        unjustifiedAbsences: Number(unjustifiedAbsences) || 0,
        weeklyRestDay: Number(weeklyRestDay),
        employeeAgreedToSplit,
        thirteenthAdvanceRequested,
        warnings: record?.warnings ?? [],
      };
      const payload = recordType === 'gozo'
        ? {
            ...common,
            days: enjoymentDays,
            startDate,
            endDate,
            returnDate,
            calendarId,
            allowanceRequestedAt: undefined,
          }
        : {
            ...common,
            days: Number(allowanceDays),
            startDate: undefined,
            endDate: undefined,
            returnDate: undefined,
            calendarId: undefined,
            allowanceRequestedAt,
          };

      if (record) await updateVacation({ ...record, ...payload });
      else await addVacation(payload);

      toast({
        title: isEdit ? 'Férias atualizadas.' : 'Férias registradas.',
        description: isEdit
          ? 'O período foi reanalisado pelas regras de férias.'
          : 'O lançamento entrou como pendente e está pronto para revisão.',
      });
      onBack();
    } catch (error) {
      toast({
        title: isEdit ? 'Não foi possível atualizar as férias.' : 'Não foi possível registrar as férias.',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'mt-1.5 h-10 w-full rounded-[10px] border bg-background px-3 text-[12.5px] font-semibold outline-none transition-colors focus:border-primary';
  const labelClass = 'text-[10.5px] font-extrabold text-slate-600 dark:text-slate-300';

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b px-5 py-4">
        <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={onBack} disabled={saving} aria-label="Voltar à ficha de férias">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-muted-foreground">Ciclo {cycle.id}</p>
          <h3 className="mt-1 truncate text-[17px] font-black tracking-tight">{isEdit ? 'Editar período de férias' : 'Registrar férias'}</h3>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">{employeeName}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <label>
            <span className={labelClass}>Ciclo</span>
            <span className={`${inputClass} flex items-center bg-muted/50`}>{cycle.id} · saldo {Math.max(0, cycle.balance)}d</span>
          </label>
          <label>
            <span className={labelClass}>Tipo</span>
            <select className={inputClass} value={recordType} onChange={event => setRecordType(event.target.value as 'gozo' | 'venda')} disabled={saving}>
              <option value="gozo">Gozo</option>
              <option value="venda">Venda (abono)</option>
            </select>
          </label>
        </div>

        {recordType === 'gozo' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={labelClass}>Início</span>
                <input className={inputClass} type="date" value={startDate} onChange={event => setStartDate(event.target.value)} disabled={saving} />
              </label>
              <label>
                <span className={labelClass}>Fim</span>
                <input className={inputClass} type="date" value={endDate} onChange={event => setEndDate(event.target.value)} disabled={saving} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={labelClass}>Calendário aplicável</span>
                <select className={inputClass} value={calendarId} onChange={event => setCalendarId(event.target.value)} disabled={saving}>
                  <option value="">Selecione</option>
                  {calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name} · {calendar.year}</option>)}
                </select>
              </label>
              <label>
                <span className={labelClass}>Descanso semanal</span>
                <select className={inputClass} value={weeklyRestDay} onChange={event => setWeeklyRestDay(event.target.value)} disabled={saving}>
                  {WEEKDAYS.map((weekday, index) => <option key={weekday} value={index}>{weekday}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={labelClass}>Dias</span>
                <span className={`${inputClass} flex items-center bg-muted/50`}>{validRange ? `${enjoymentDays} dias` : 'Calculado'}</span>
              </label>
              <label>
                <span className={labelClass}>Retorno</span>
                <span className={`${inputClass} flex items-center bg-muted/50`}>{returnDate ? format(parseISO(returnDate), 'dd/MM/yyyy') : 'Calculado'}</span>
              </label>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={labelClass}>Dias de abono</span>
              <input className={inputClass} type="number" min={1} max={10} value={allowanceDays} onChange={event => setAllowanceDays(event.target.value)} disabled={saving} />
            </label>
            <label>
              <span className={labelClass}>Data do pedido</span>
              <input className={inputClass} type="date" value={allowanceRequestedAt} onChange={event => setAllowanceRequestedAt(event.target.value)} disabled={saving} />
            </label>
          </div>
        )}

        <label className="block">
          <span className="flex items-center justify-between gap-3">
            <span className={labelClass}>Faltas injustificadas no ciclo</span>
            <span className="text-[10px] font-bold text-muted-foreground">direito a {entitlementDays}d</span>
          </span>
          <input className={inputClass} type="number" min={0} max={100} value={unjustifiedAbsences} onChange={event => setUnjustifiedAbsences(event.target.value)} disabled={saving} />
        </label>

        <div className="space-y-3 rounded-xl border p-3">
          <label className="flex items-start gap-2.5 text-[11.5px] font-semibold">
            <input className="mt-0.5 h-4 w-4 accent-primary" type="checkbox" checked={employeeAgreedToSplit} onChange={event => setEmployeeAgreedToSplit(event.target.checked)} disabled={saving} />
            Colaborador concordou com o fracionamento
          </label>
          <label className="flex items-start gap-2.5 text-[11.5px] font-semibold">
            <input className="mt-0.5 h-4 w-4 accent-primary" type="checkbox" checked={thirteenthAdvanceRequested} onChange={event => setThirteenthAdvanceRequested(event.target.checked)} disabled={saving} />
            Adiantamento da 1ª parcela do 13º solicitado
          </label>
        </div>

        {recordType === 'gozo' && noticeLeadDays !== null ? (
          <div className={`rounded-xl border p-3 ${shortNotice ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/25' : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/25'}`}>
            <div className="flex items-start gap-2.5">
              {shortNotice ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <CalendarCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />}
              <div>
                <p className={`text-xs font-black ${shortNotice ? 'text-red-800 dark:text-red-300' : 'text-amber-900 dark:text-amber-200'}`}>
                  {shortNotice ? 'Aviso de férias com menos de 30 dias de antecedência' : `Aviso com ${noticeLeadDays} dias de antecedência · dentro da regra`}
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted-foreground">
                  {shortNotice
                    ? `O início escolhido deixa apenas ${noticeLeadDays} dias de aviso. O lançamento ficará sinalizado na trilha e exigirá justificativa formal no envio.`
                    : `Calendário ${selectedCalendar?.name ?? 'selecionado'}, retorno calculado para ${returnDate ? format(parseISO(returnDate), 'dd/MM/yyyy') : '—'} e conferência legal refeita no servidor ao salvar.`}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-5 py-3.5">
        <Button type="button" variant="outline" onClick={onBack} disabled={saving}>Cancelar</Button>
        <Button type="button" className="min-w-[150px]" onClick={() => void save()} disabled={!saveEnabled}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEdit ? 'Salvar alterações' : 'Salvar lançamento'}
        </Button>
      </div>
    </>
  );
}
