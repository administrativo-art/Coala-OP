import "server-only";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentMappingSchema } from "../agent/contracts";
import { readFinancialAgentMapping } from "../agent/mapping.server";
import { MAX_AGENT_MAPPINGS } from "../agent/mapping";
import { requireStoredPdvFilial, type SalesReviewRequest } from "./query";

export async function readSalesReviewBinding(request: SalesReviewRequest, workspaceId: string) {
  const mapping = await readFinancialAgentMapping({ ...request, intent: "review_anticipations", prioritizeWithAi: false }, workspaceId);
  // Exact document read, not a unit collection scan. Never use the legacy filial fallback.
  const kiosk = await dbAdmin.collection("kiosks").doc(mapping.kioskId).get();
  return { mapping, pdvFilialId: requireStoredPdvFilial(kiosk.data(), workspaceId) };
}

type CalendarBindingRequest = Pick<SalesReviewRequest, "kioskId" | "mappingId" | "stoneCode">;

function invalidCalendarBinding(code: string, message: string): never {
  throw new AppError({ code, kind: "EXPECTED_BUSINESS", safeMessage: message });
}

export async function readSalesReviewCalendarBinding(request: CalendarBindingRequest, workspaceId: string) {
  const snapshot = await financialDbAdmin.collection("stoneMerchantMappings").doc(request.mappingId).get();
  const parsed = financialAgentMappingSchema.safeParse(snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null);
  if (!parsed.success || parsed.data.workspaceId !== workspaceId) {
    invalidCalendarBinding("SALES_REVIEW_CALENDAR_BINDING_REQUIRED", "O vínculo da conciliação não foi encontrado neste workspace.");
  }
  const mapping = parsed.data;
  if (mapping.kioskId !== request.kioskId || !mapping.stoneCodes.includes(request.stoneCode) || mapping.terminalIds.length > 0) {
    invalidCalendarBinding("SALES_REVIEW_CALENDAR_SCOPE_INVALID", "O vínculo não corresponde à unidade e ao StoneCode selecionados.");
  }
  return mapping;
}

export async function listAutomatedSalesReviewMappings(workspaceId: string) {
  const snapshot = await financialDbAdmin.collection("stoneMerchantMappings")
    .where("workspaceId", "==", workspaceId)
    .where("status", "==", "active")
    .limit(MAX_AGENT_MAPPINGS + 1)
    .get();
  if (snapshot.size > MAX_AGENT_MAPPINGS) {
    invalidCalendarBinding("SALES_REVIEW_AUTOMATION_MAPPING_LIMIT", "A rotina encontrou mais vínculos Stone do que o limite operacional.");
  }
  return snapshot.docs.map(document => {
    const parsed = financialAgentMappingSchema.safeParse({ ...document.data(), id: document.id });
    if (!parsed.success || parsed.data.workspaceId !== workspaceId || parsed.data.status !== "active") {
      invalidCalendarBinding("SALES_REVIEW_AUTOMATION_MAPPING_INVALID", "A rotina encontrou um vínculo Stone inválido.");
    }
    return parsed.data;
  });
}
