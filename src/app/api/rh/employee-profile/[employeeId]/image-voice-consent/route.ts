import { NextResponse, type NextRequest } from "next/server";

import { requireUser } from "@/lib/auth-server";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientEvidence(request: NextRequest) {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || null,
    user_agent: request.headers.get("user-agent")?.trim().slice(0, 500) || null,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ employeeId: string }> },
) {
  try {
    const actor = await requireUser(request);
    const { employeeId } = await context.params;
    const normalizedEmployeeId = decodeURIComponent(employeeId ?? "").trim();
    if (!normalizedEmployeeId) {
      return NextResponse.json({ error: "Colaborador obrigatório." }, { status: 400 });
    }

    const employeeRef = hrDbAdmin.collection("employees").doc(normalizedEmployeeId);
    const employeeSnap = await employeeRef.get();
    if (!employeeSnap.exists) {
      return NextResponse.json({ error: "Colaborador não encontrado no RH." }, { status: 404 });
    }

    const employee = employeeSnap.data() ?? {};
    const isOwner = employee.auth_uid === actor.userDoc.id
      || actor.userDoc.registrationIdBizneo === normalizedEmployeeId
      || actor.userDoc.id === normalizedEmployeeId;
    if (!isOwner) {
      return NextResponse.json(
        { error: "Somente o próprio colaborador pode revogar esta autorização." },
        { status: 403 },
      );
    }

    let current = employee.consentimento_imagem_voz && typeof employee.consentimento_imagem_voz === "object"
      ? employee.consentimento_imagem_voz as Record<string, unknown>
      : null;
    let onboardingRef: FirebaseFirestore.DocumentReference | null = null;
    const currentOnboardingId = current && typeof current.onboarding_id === "string"
      ? current.onboarding_id.trim()
      : "";
    if (currentOnboardingId) {
      onboardingRef = hrDbAdmin.collection("onboardingProcesses").doc(currentOnboardingId);
    }
    if (!current) {
      let onboardingSnap = await hrDbAdmin
        .collection("onboardingProcesses")
        .where("employeeId", "==", normalizedEmployeeId)
        .limit(1)
        .get();
      const employeeEmail = typeof employee.email === "string" ? employee.email.trim().toLowerCase() : "";
      if (onboardingSnap.empty && employeeEmail) {
        onboardingSnap = await hrDbAdmin
          .collection("onboardingProcesses")
          .where("candidateEmail", "==", employeeEmail)
          .limit(1)
          .get();
      }
      if (!onboardingSnap.empty) {
        const onboardingDoc = onboardingSnap.docs[0];
        const onboardingConsent = onboardingDoc.get("consentimento_imagem_voz");
        if (onboardingConsent && typeof onboardingConsent === "object") {
          current = onboardingConsent as Record<string, unknown>;
          onboardingRef = onboardingDoc.ref;
        }
      }
    }
    if (!current || current.autorizado !== true) {
      return NextResponse.json(
        { error: "A autorização de imagem e voz já está revogada ou não foi concedida." },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const evidence = clientEvidence(request);
    const eventRef = employeeRef.collection("consentimentos_imagem_voz_historico").doc();
    const notificationRef = hrDbAdmin.collection("hrNotifications").doc(`image_voice_revocation_${eventRef.id}`);
    const auditRef = hrDbAdmin.collection("audit_log").doc();
    const nextConsent = {
      ...current,
      autorizado: false,
      respondido_em: now,
      ...evidence,
      origem: "perfil_colaborador",
      revogado_por: actor.userDoc.id,
      evento_id: eventRef.id,
    };

    const batch = hrDbAdmin.batch();
    if (!employee.consentimento_imagem_voz && typeof current.protocolo === "string" && current.protocolo.trim()) {
      const initialEventRef = employeeRef
        .collection("consentimentos_imagem_voz_historico")
        .doc(current.protocolo.trim());
      const initialEventSnap = await initialEventRef.get();
      if (!initialEventSnap.exists) {
        batch.create(initialEventRef, {
          ...current,
          evento: "autorizacao_concedida",
          employee_id: normalizedEmployeeId,
          migrated_to_employee_at: now,
        });
      }
    }
    batch.update(employeeRef, {
      consentimento_imagem_voz: nextConsent,
      updated_at: now,
    });
    batch.create(eventRef, {
      ...nextConsent,
      evento: "autorizacao_revogada",
      employee_id: normalizedEmployeeId,
      valor_anterior: true,
      valor_novo: false,
      created_at: now,
    });
    if (onboardingRef) {
      batch.set(onboardingRef, { consentimento_imagem_voz: nextConsent, updatedAt: now }, { merge: true });
      batch.create(onboardingRef.collection("consentimentos_imagem_voz_historico").doc(eventRef.id), {
        ...nextConsent,
        evento: "autorizacao_revogada",
        employee_id: normalizedEmployeeId,
        valor_anterior: true,
        valor_novo: false,
        created_at: now,
      });
    }
    batch.create(notificationRef, {
      type: "image_voice_consent_revoked",
      status: "pending",
      employeeId: normalizedEmployeeId,
      employeeName: typeof employee.name === "string" ? employee.name : normalizedEmployeeId,
      title: "Autorização de imagem e voz revogada",
      message: `${typeof employee.name === "string" ? employee.name : "Um colaborador"} revogou a autorização de uso de imagem e voz. Remova, em prazo razoável, os materiais dos canais digitais próprios da empresa. Materiais impressos já distribuídos anteriormente não são afetados.`,
      channels: ["in_app"],
      recipient: { type: "team", id: "marketing_administrativo", label: "Marketing / Administrativo" },
      consentEventId: eventRef.id,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userDoc.id,
    });
    batch.create(auditRef, {
      employee_id: normalizedEmployeeId,
      field_key: "employee.consentimento_imagem_voz",
      old_value: current,
      new_value: nextConsent,
      changed_by: actor.userDoc.id,
      changed_at: now,
      source: "user_edit",
      action: "IMAGE_VOICE_CONSENT_REVOKED",
      notification_id: notificationRef.id,
    });
    await batch.commit();

    return NextResponse.json({
      consentimento_imagem_voz: nextConsent,
      notificationId: notificationRef.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao revogar autorização." },
      { status: 400 },
    );
  }
}
