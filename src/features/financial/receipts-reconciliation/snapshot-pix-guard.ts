/**
 * Um retrato mensal da conferência Stone em que o Pix está indisponível em todos os dias do período foi montado sem a
 * fonte do Pix (por exemplo, um script sem `STONE_CONCILIATION_DOCUMENT`). Salvá-lo faria o fechamento mostrar o Pix de um
 * mês inteiro como não conferido, sem que a rotina diária o corrija depois. A gravação recusa esse retrato.
 */
export function stoneSnapshotMissesPixSource(result: {
  period: { from: string; through: string };
  coverage?: { pixUnavailableDates?: readonly string[] };
}) {
  const day = 86_400_000;
  const days = Math.round((Date.parse(`${result.period.through}T00:00:00Z`) - Date.parse(`${result.period.from}T00:00:00Z`)) / day) + 1;
  return Number.isFinite(days) && days > 0 && new Set(result.coverage?.pixUnavailableDates ?? []).size >= days;
}
