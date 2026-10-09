import type { EmployeeEarningsRow } from '@/lib/goals-earnings';

function cell(value: string | number) {
  const text = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value;
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Folha de premiação do mês por colaborador. Separador `;` e BOM para abrir direto no Excel em pt-BR. */
export function buildEarningsCsv(
  rows: EmployeeEarningsRow[],
  names: { user: (id: string) => string; kiosk: (id: string) => string },
): string {
  const header = ['Colaborador', 'Quiosque(s)', 'Metas', 'Faturamento (R$)', 'Atingimento (%)', 'Premiação (R$)'];
  const lines = rows.map(row => [
    names.user(row.employeeId),
    row.kioskIds.map(names.kiosk).join(' / '),
    String(row.periodCount),
    row.revenue,
    row.avgAttainment,
    row.prize,
  ].map(cell).join(';'));
  const total = rows.reduce((sum, row) => sum + row.prize, 0);
  lines.push(['Total', '', '', '', '', total].map(cell).join(';'));
  return `﻿${[header.join(';'), ...lines].join('\r\n')}`;
}
