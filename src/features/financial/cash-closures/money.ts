/**
 * Toda quantia monetária do módulo de fechamento de caixa trafega em centavos
 * inteiros (sufixo `Cents`). Nunca comparar ou somar reais em ponto flutuante
 * perto do limite de bloco de depósito (R$ 5.000,00).
 */

export function toCents(reaisValue: number): number {
  if (!Number.isFinite(reaisValue)) return 0;
  return Math.round(reaisValue * 100);
}

export function centsToReais(cents: number): number {
  return cents / 100;
}

export function sumCents(...values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? Math.trunc(value) : 0), 0);
}

const BRL_FORMATTER = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  return BRL_FORMATTER.format(centsToReais(cents));
}
