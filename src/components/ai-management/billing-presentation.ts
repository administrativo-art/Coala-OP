import type { BillingAlert } from "@/features/ai-management/types";

export function formatBillingBytes(value: number | null) {
  if (value === null) return "Não disponível";
  if (value < 1024 ** 2) return `${value.toLocaleString("pt-BR")} bytes`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MiB`;
  if (value < 1024 ** 4) return `${(value / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GiB`;
  return `${(value / 1024 ** 4).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} TiB`;
}

export function formatBillingGeneratedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Belem",
  }).format(date);
}

export function billingAlertPresentation(alert: BillingAlert, provider: "openai" | "google") {
  const percent = alert.usedPercent?.toLocaleString("pt-BR");
  const level = alert.level;
  const title = provider === "openai"
    ? level === "unavailable" ? "Régua interna indisponível" : level === "critical" ? "Régua interna em 95% ou mais" : level === "warning" ? "Atenção à régua interna" : "Régua interna acompanhada"
    : level === "unavailable" ? "Estimativa da franquia indisponível" : level === "critical" ? "Projeção do painel em 95% ou mais" : level === "warning" ? "Atenção à projeção do painel" : "Projeção do painel abaixo de 80%";
  const description = provider === "openai"
    ? level === "unavailable"
      ? "Defina uma régua mensal para acompanhar os marcos de 80% e 95%."
      : `${percent}% da régua interna utilizado pelo gasto oficial. Alertas em 80% e 95%; o custo pode ser contabilizado com atraso.`
    : level === "unavailable"
      ? "A projeção mensal da franquia ainda não pôde ser validada para este painel."
      : `${percent}% de 1 TiB projetado para as consultas deste painel, considerando até 25 consultas por dia em uma instância. Não mede o uso total da franquia da conta.`;
  return {
    title,
    description,
    pill: level === "critical" ? "95% ou mais" : level === "warning" ? "80% ou mais" : level === "unavailable" ? provider === "openai" ? "Sem régua" : "Sem estimativa" : "Abaixo de 80%",
    pillVariant: level === "critical" ? "danger" as const : level === "warning" ? "warn" as const : level === "unavailable" ? "neutral" as const : "ok" as const,
  };
}
