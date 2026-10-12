import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export type MonthOption = { key: string; label: string };

export function monthKeyOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** `yyyy-MM` → primeiro dia do mês (horário local). */
export function monthStartOf(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, 1);
}

/** Últimos `count` meses, do mais recente para o mais antigo, incluindo o mês de `from`. */
export function listRecentMonths(from: Date, count = 13): MonthOption[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(from.getFullYear(), from.getMonth() - index, 1);
    return { key: monthKeyOf(date), label: format(date, "MMMM/yyyy", { locale: ptBR }) };
  });
}
