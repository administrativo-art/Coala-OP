import { z } from "zod";
import {
  hasExplicitPdvItemCancellation,
  isPdvCouponMarkedCancelled,
  pdvCouponItems,
  pdvCouponTimestamp,
} from "@/lib/integrations/pdv-coupon-ingestion";

/**
 * Camada de parsing defensivo do cupom do PDV Legal para o motor de
 * fechamento de caixa. Só extrai os fatos de que a agregação por
 * operador × canal precisa (seção 5 do plano) — não lida com itens/SKU,
 * isso é escopo do parser de vendas existente em `pdv-legal-admin.ts`.
 *
 * O PDV varia a caixa dos campos entre chamadas (`Itens`/`itens`,
 * `ValorTotal`/`valortotal`), então cada campo é lido por múltiplas chaves
 * possíveis em vez de assumir uma única forma.
 */

const RawRecordSchema = z.record(z.string(), z.unknown());
const RawCouponsSchema = z.array(RawRecordSchema);

export type ParsedFormaPagamento = {
  rawName: string;
  /** Valor em reais, como reportado pelo PDV (TROCO vem positivo). */
  amount: number;
};

export type ParsedCoupon = {
  couponId: string;
  operatorId: string | null;
  /** Timestamp bruto do PDV, usado para bucket de dia (ver date.ts). */
  timestamp: string;
  isCancelled: boolean;
  isStorned: boolean;
  itemCount: number;
  hasExplicitItemCancellation: boolean;
  totalAmount: number;
  paymentRows: ParsedFormaPagamento[];
};

export type ParsePdvCouponsResult = {
  coupons: ParsedCoupon[];
  parseWarnings: string[];
};

function pickString(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  return 0;
}

function pickBoolean(row: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toUpperCase();
      if (normalized === "CANCELADO" || normalized === "TRUE" || normalized === "1") return true;
    }
  }
  return false;
}

function pickArray(row: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function parsePdvCoupons(raw: unknown): ParsePdvCouponsResult {
  const parsedRaw = RawCouponsSchema.safeParse(raw);
  if (!parsedRaw.success) {
    throw new Error(
      "Formato de cupons do PDV Legal não reconhecido pelo motor de fechamento de caixa (esperado array de objetos).",
    );
  }

  const parseWarnings: string[] = [];
  const coupons: ParsedCoupon[] = [];

  parsedRaw.data.forEach((row, index) => {
    const couponId = pickString(row, "codcupom", "CodCupom", "codCupom") ?? `sem-id-${index}`;
    const operatorId = pickString(
      row,
      "usuariorecebimento_id",
      "UsuarioRecebimento_Id",
      "usuarioRecebimentoId",
      "usuarioRecebimento_Id",
    );
    const timestamp = pdvCouponTimestamp(row);
    const isCancelled = isPdvCouponMarkedCancelled(row);
    const isStorned = pickBoolean(row, "isestornado", "IsEstornado");
    const totalAmount = pickNumber(row, "valortotal", "ValorTotal");

    const rawItems = pdvCouponItems(row);
    const hasExplicitItemCancellation = hasExplicitPdvItemCancellation(row);

    const rawPayments = pickArray(row, "formaPgtos", "FormaPgtos", "formapgtos");
    const paymentRows: ParsedFormaPagamento[] = rawPayments.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const formRow = entry as Record<string, unknown>;
      const rawName = pickString(formRow, "nome", "Nome");
      if (!rawName) {
        parseWarnings.push(`Cupom ${couponId}: forma de pagamento sem campo "nome" foi ignorada.`);
        return [];
      }
      return [{ rawName, amount: pickNumber(formRow, "valortotal", "ValorTotal") }];
    });

    if (!timestamp) {
      parseWarnings.push(`Cupom ${couponId}: sem data de recebimento/abertura, ignorado no bucket diário.`);
      return;
    }

    coupons.push({
      couponId,
      operatorId,
      timestamp,
      isCancelled,
      isStorned,
      itemCount: rawItems.length,
      hasExplicitItemCancellation,
      totalAmount,
      paymentRows,
    });
  });

  return { coupons, parseWarnings };
}
