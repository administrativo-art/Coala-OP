import type {
  InstagramInsightStoredDay,
  InstagramInsightsReport,
  PublicBioAnalyticsReport,
} from "./contracts";

export type InstagramHistoryCoverage = {
  capturedDays: number;
  firstDate: string | null;
  lastDate: string | null;
  complete: boolean;
};

export function summarizeInstagramHistoryCoverage(
  daily: InstagramInsightStoredDay[],
  requestedDays: number,
): InstagramHistoryCoverage {
  const dates = [...new Set(daily.map((day) => day.date))].sort();
  return {
    capturedDays: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    complete: dates.length >= requestedDays,
  };
}

export type InstagramInsightReading = {
  discovery: {
    value: number | null;
    date: string | null;
  };
  interactionsPerHundredViews: number | null;
  profileClickRate: number | null;
  topContent: InstagramInsightsReport["content"][number] | null;
  recommendation: string;
};

export type InstagramContentFormatSummary = {
  format: InstagramInsightsReport["content"][number]["format"];
  contentCount: number;
  views: number | null;
  reach: number | null;
  interactions: number | null;
  averageInteractions: number | null;
};

function rate(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

export function buildInstagramInsightReading(report: InstagramInsightsReport): InstagramInsightReading {
  const discovery = report.reachSeries.reduce<InstagramInsightReading["discovery"]>(
    (peak, point) => peak.value === null || point.value > peak.value
      ? { value: point.value, date: point.date }
      : peak,
    { value: null, date: null },
  );
  const interactionsPerHundredViews = rate(report.totals.totalInteractions, report.totals.views);
  const profileClickRate = rate(
    report.businessSuiteTotals.profileLinkClicks,
    report.businessSuiteTotals.profileVisits,
  );
  const topContent = report.content.reduce<InstagramInsightReading["topContent"]>((best, item) => {
    if (item.totalInteractions === null) return best;
    return !best || item.totalInteractions > (best.totalInteractions ?? -1) ? item : best;
  }, null);

  let recommendation = "Continue coletando dados para formar uma base comparável e orientar a próxima decisão.";
  if (
    report.businessSuiteTotals.profileVisits !== null
    && report.businessSuiteTotals.profileVisits > 0
    && report.businessSuiteTotals.profileLinkClicks === 0
  ) {
    recommendation = "Há visitas ao perfil, mas nenhum clique registrado. Revise a promessa e o chamado para ação da bio.";
  } else if (interactionsPerHundredViews !== null && interactionsPerHundredViews < 1) {
    recommendation = "A exposição ainda gera pouca resposta. Teste aberturas mais diretas e chamadas claras para comentar, salvar ou compartilhar.";
  } else if (topContent) {
    recommendation = `O conteúdo com maior resposta foi um ${topContent.format.toLowerCase()}. Reaproveite o tema ou a estrutura em uma nova publicação.`;
  }

  return {
    discovery,
    interactionsPerHundredViews,
    profileClickRate,
    topContent,
    recommendation,
  };
}

export function summarizeInstagramContentFormats(
  content: InstagramInsightsReport["content"],
): InstagramContentFormatSummary[] {
  const formats = new Map<InstagramContentFormatSummary["format"], InstagramInsightsReport["content"]>();
  content.forEach((item) => formats.set(item.format, [...(formats.get(item.format) ?? []), item]));

  const sum = (
    items: InstagramInsightsReport["content"],
    field: "views" | "reach" | "totalInteractions",
  ) => {
    const values = items.flatMap((item) => item[field] === null ? [] : [item[field]]);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };

  return [...formats.entries()].map(([format, items]) => {
    const interactions = sum(items, "totalInteractions");
    return {
      format,
      contentCount: items.length,
      views: sum(items, "views"),
      reach: sum(items, "reach"),
      interactions,
      averageInteractions: interactions === null ? null : interactions / items.length,
    };
  }).sort((left, right) => (
    (right.averageInteractions ?? -1) - (left.averageInteractions ?? -1)
    || (right.views ?? -1) - (left.views ?? -1)
  ));
}

export function publicBioMetric(
  report: PublicBioAnalyticsReport,
  metric: "pageViews" | "linkClicks" | "galleryOpens",
) {
  return report.daily.length ? report[metric] : null;
}
