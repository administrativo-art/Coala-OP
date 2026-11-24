import { CnpjValidator } from '@/lib/company/cnpj-validator';
import type { ProviderClosureContent } from './closure-types';

const dateLabel = (value: string) => value.split('-').reverse().join('/');
export function closureMinutes(value: number) {
  const absolute = Math.abs(value);
  return (value < 0 ? '−' : '') + Math.floor(absolute / 60) + 'h' + String(absolute % 60).padStart(2, '0');
}
const effects: Record<string, string> = {
  excused_absence: 'Ausência abonada', unexcused_absence: 'Ausência sem abono',
  worked_credit: 'Crédito de jornada', time_bank_debit: 'Débito no banco de horas', manual_review: 'Conferência manual',
};
export function ProviderClosureContentView({ content }: { content: ProviderClosureContent }) {
  const payroll = content.payroll;
  return <div className="space-y-6">
    <header className="space-y-1">
      <h3 className="text-xl font-bold">{content.employee.name}</h3>
      {content.employee.cpfMasked ? <p className="text-sm text-ds-ink-muted">CPF {content.employee.cpfMasked}</p> : null}
      <p className="text-sm">{content.employer.name} · {CnpjValidator.format(content.employer.cnpj)}</p>
      <p className="text-sm text-ds-ink-muted">{new Date(content.competence + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · versão {content.closureVersion}</p>
    </header>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo do colaborador">
      {[
        ['Dias escalados', payroll.scheduledDays], ['Dias com trabalho', payroll.workedDays],
        ['Faltas injustificadas', payroll.unjustifiedAbsenceDates.length], ['Tempo noturno', closureMinutes(payroll.nightMinutes)],
      ].map(([label, value]) => <div key={label} className="rounded-ds-md border border-ds-border p-3"><p className="text-sm text-ds-ink-muted">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}
    </section>
    <section className="space-y-3"><h4 className="font-bold">Horas extras e descontos</h4>
      {!payroll.overtime.length ? <p className="text-sm text-ds-ink-muted">Sem horas extras nesta entrega.</p> : <ul className="divide-y divide-ds-border">
        {payroll.overtime.map((line, index) => <li key={index} className="py-2 text-sm">
          {line.ratePercent.toLocaleString("pt-BR")}% · {line.destination === 'payroll' ? 'Folha' : 'Crédito no banco'} · {closureMinutes(line.minutes)}
          {line.creditFactor !== null && line.destination === 'time_bank' ? ' · fator ' + line.creditFactor.toLocaleString('pt-BR') : ''}
        </li>)}
      </ul>}
      {payroll.expiredCreditMinutes > 0 ? <p className="text-sm">Créditos vencidos destinados à folha · {closureMinutes(payroll.expiredCreditMinutes)}</p> : null}
      {payroll.bankPayrollMinutes > 0 ? <p className="text-sm">Banco de horas encaminhado à folha · {closureMinutes(payroll.bankPayrollMinutes)}</p> : null}
      <p className="text-sm">Tempo total destinado à folha · {closureMinutes(payroll.payrollOvertimeMinutes)}</p>
      <p className="text-sm">Tempo para desconto na folha · {closureMinutes(payroll.discountMinutes)}</p>
    </section>
    <section className="space-y-2"><h4 className="font-bold">Movimento do banco de horas no mês</h4>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-ds-ink-muted">Créditos</dt><dd className="font-semibold">{closureMinutes(payroll.creditMinutes)}</dd></div>
        <div><dt className="text-ds-ink-muted">Débitos</dt><dd className="font-semibold">{closureMinutes(payroll.debitMinutes)}</dd></div>
        <div><dt className="text-ds-ink-muted">Movimento líquido</dt><dd className="font-semibold">{closureMinutes(payroll.monthBalanceMinutes)}</dd></div>
      </dl>
    </section>
    <section className="space-y-2"><h4 className="font-bold">Faltas e ausências consideradas</h4>
      {payroll.unjustifiedAbsenceDates.length ? <p className="text-sm">Faltas injustificadas · {payroll.unjustifiedAbsenceDates.map(dateLabel).join(', ')}</p> : null}
      {payroll.absenceEffects.length ? <ul className="space-y-1 text-sm">{payroll.absenceEffects.map((absence, index) => <li key={index}>{dateLabel(absence.date)} · {effects[absence.effect] ?? 'Efeito na jornada'}</li>)}</ul> :
        <p className="text-sm text-ds-ink-muted">Sem outras ausências nesta entrega.</p>}
    </section>
    <section className="space-y-3"><h4 className="font-bold">Marcações do espelho do fechamento</h4>
      <div className="overflow-x-auto rounded-ds-md border border-ds-border"><table className="w-full text-left text-sm">
        <thead><tr className="border-b border-ds-border"><th className="p-3">Dia</th><th className="p-3">Marcações</th><th className="p-3">Horas pelas marcações</th></tr></thead>
        <tbody>{content.mirror.days.map((day) => <tr key={day.date} className="border-b border-ds-border last:border-0">
          <td className="whitespace-nowrap p-3">{dateLabel(day.date)}</td>
          <td className="p-3">{day.punches.length ? <div className="flex flex-wrap gap-2">{day.punches.map((punch, index) =>
            <span key={index} className={punch.state === 'discarded' ? 'text-ds-ink-muted' : ''}>{punch.time}{punch.state === 'discarded' ? ' (desconsiderada)' : punch.state === 'included' ? ' (incluída)' : ''}</span>)}</div> : '—'}</td>
          <td className="whitespace-nowrap p-3">{day.pairedMinutes === null ? 'A conferir' : closureMinutes(day.pairedMinutes)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
