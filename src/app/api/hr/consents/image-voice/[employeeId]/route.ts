import { NextResponse, type NextRequest } from "next/server";

import {
  markImageVoiceUsageRemoved,
  normalizeImageVoiceConsent,
  registerImageVoiceUsage,
} from "@/features/hr/consents/image-voice-consent";
import {
  assertFormalizationAccess,
  serializeHrValue,
} from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { resolvePersonLink } from "@/features/hr/lib/person-link.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function employeeReference(employeeId: string) {
  const id = decodeURIComponent(employeeId ?? "").trim();
  if (!id) throw new Error("Colaborador obrigatório.");
  const link = await resolvePersonLink(id);
  if (!link.employeeDocument?.exists) throw new Error("Colaborador não encontrado no RH.");
  return { id: link.employeeDocument.id, ref: link.employeeDocument.ref, snapshot: link.employeeDocument };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> },
) {
  try {
    await assertFormalizationAccess(request, "consents.view");
    const { employeeId } = await context.params;
    const employee = await employeeReference(employeeId);
    return NextResponse.json({
      employeeId: employee.id,
      employeeName: employee.snapshot.get("name") ?? null,
      consent: serializeHrValue(
        normalizeImageVoiceConsent(employee.snapshot.get("consentimento_imagem_voz")),
      ),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao consultar consentimento." },
      { status: 403 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> },
) {
  try {
    const actor = await assertFormalizationAccess(request, "consents.manage");
    const { employeeId } = await context.params;
    const employee = await employeeReference(employeeId);
    const input = await request.json() as Record<string, unknown>;
    const action = cleanText(input.action, 40);
    const now = new Date().toISOString();
    const eventRef = employee.ref.collection("consentimentos_imagem_voz_historico").doc();
    const auditRef = hrDbAdmin.collection("audit_log").doc();

    const next = await hrDbAdmin.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(employee.ref);
      const rawCurrent = currentSnapshot.get("consentimento_imagem_voz");
      let state;
      let event: string;

      if (action === "register_usage") {
        const channel = cleanText(input.channel, 120);
        const asset = cleanText(input.asset, 500);
        const publishedAt = cleanText(input.publishedAt, 40) || now;
        state = registerImageVoiceUsage(rawCurrent, {
          usageId: eventRef.id,
          channel,
          asset,
          publishedAt,
          registeredAt: now,
          registeredBy: actor.decoded.uid,
        });
        event = "uso_registrado";
      } else if (action === "mark_removed") {
        const usageId = cleanText(input.usageId, 120);
        state = markImageVoiceUsageRemoved(rawCurrent, {
          usageId,
          removedAt: now,
          removedBy: actor.decoded.uid,
        });
        event = "uso_retirado";
      } else {
        throw new Error("Ação de consentimento inválida.");
      }

      const legacyCompatible = {
        ...rawCurrent,
        ...state,
        autorizado: state.status === "granted",
      };
      transaction.update(employee.ref, {
        consentimento_imagem_voz: legacyCompatible,
        updated_at: now,
      });
      transaction.create(eventRef, {
        evento: event,
        employee_id: employee.id,
        consent_status: state.status,
        usage_id: action === "mark_removed" ? cleanText(input.usageId, 120) : eventRef.id,
        channel: cleanText(input.channel, 120) || null,
        asset: cleanText(input.asset, 500) || null,
        created_at: now,
        created_by: actor.decoded.uid,
      });
      transaction.create(auditRef, {
        employee_id: employee.id,
        field_key: "employee.consentimento_imagem_voz.usages",
        action: action === "register_usage"
          ? "IMAGE_VOICE_USAGE_REGISTERED"
          : "IMAGE_VOICE_USAGE_REMOVED",
        changed_by: actor.decoded.uid,
        changed_at: now,
        consent_event_id: eventRef.id,
      });
      return state;
    });

    return NextResponse.json({ employeeId: employee.id, consent: next });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao atualizar consentimento." },
      { status: 400 },
    );
  }
}
