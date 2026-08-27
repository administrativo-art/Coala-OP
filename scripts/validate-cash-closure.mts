/**
 * Script de validação manual do motor de fechamento de caixa (Fase 1, A1.5).
 * Busca cupons reais do PDV Legal para uma unidade/data e imprime o
 * fechamento calculado, para comparação manual com a conferência atual.
 *
 * Uso:
 *   node --import tsx scripts/validate-cash-closure.mts <kioskId> <yyyy-mm-dd>
 *   node --import tsx scripts/validate-cash-closure.mts tirirical 2026-07-07
 *   node --import tsx scripts/validate-cash-closure.mts all 2026-07-29,2026-07-30
 *
 * Sem argumentos, roda para tirirical e joao-paulo no dia de ontem.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { buildCashClosureFromPdv } from "../src/features/financial/cash-closures/build-cash-closure";
import { formatBRL } from "../src/features/financial/cash-closures/money";
import { FALLBACK_PDV_FILIAL_IDS } from "../src/lib/kiosk-identifiers";
import { fetchAllCouponsForDay, fetchPdvLegalUsers, getAccessToken } from "../src/lib/integrations/pdv-legal-admin";

const KIOSK_NAMES: Record<string, string> = {
  tirirical: "Tirirical",
  "joao-paulo": "João Paulo",
};

function yesterdayIsoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function validateOne(kioskId: string, date: string, operatorNameById: Record<string, string>) {
  const pdvFilialId = FALLBACK_PDV_FILIAL_IDS[kioskId];
  if (!pdvFilialId) {
    console.error(`[${kioskId}] sem pdvFilialId conhecido, pulando.`);
    return;
  }

  const token = await getAccessToken();
  const coupons = await fetchAllCouponsForDay(token, date, pdvFilialId);

  const closure = buildCashClosureFromPdv(coupons, {
    workspaceId: "default",
    kioskId,
    kioskName: KIOSK_NAMES[kioskId] ?? kioskId,
    pdvFilialId,
    date,
    operatorNameById,
  });

  console.log(`\n=== ${closure.kioskName} — ${closure.date} ===`);
  console.log(`Cupons: recebidos=${closure.source.couponCount} válidos=${closure.source.validCouponCount} ` +
    `cancelados=${closure.source.ignoredCancelledCouponCount} estornados=${closure.source.estornadoCouponCount}`);
  console.log(`Total esperado: ${formatBRL(closure.expectedTotalCents)}`);

  console.log("Por canal:");
  for (const [channel, cents] of Object.entries(closure.expectedByChannelCents)) {
    console.log(`  ${channel.padEnd(14)} ${formatBRL(cents as number)}`);
  }

  console.log(`Por operador × canal (${closure.operatorCount} operadores):`);
  for (const line of closure.lines) {
    console.log(`  ${line.operatorName.padEnd(24)} ${line.channel.padEnd(14)} ${formatBRL(line.expectedAmountCents)}`);
  }

  if (closure.source.unknownPaymentNames.length > 0) {
    console.log(`⚠️  Formas de pagamento não mapeadas: ${closure.source.unknownPaymentNames.join(", ")}`);
  }
  if (closure.source.integrityWarnings.length > 0) {
    console.log("⚠️  Avisos de integridade:");
    for (const warning of closure.source.integrityWarnings) console.log(`   - ${warning}`);
  }
}

async function main() {
  const [, , kioskArg, dateArg] = process.argv;
  const dates = (dateArg ?? yesterdayIsoDate()).split(",").map(value => value.trim()).filter(Boolean);
  const kioskIds = kioskArg && kioskArg !== "all" ? [kioskArg] : Object.keys(FALLBACK_PDV_FILIAL_IDS);

  const users = await fetchPdvLegalUsers();
  const operatorNameById = Object.fromEntries(users.map((user) => [user.id, user.name]));

  for (const date of dates) {
    for (const kioskId of kioskIds) {
      await validateOne(kioskId, date, operatorNameById);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
