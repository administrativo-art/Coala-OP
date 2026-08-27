import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { generateDocumentFromTemplate } from "@/features/hr/documents/generate-document.server";
import {
  buildSignatureDocumentName,
  buildSignatureFileName,
} from "@/features/hr/documents/signature-document-name";
import { getDocumentVariable } from "@/features/hr/integration/document-variables";
import type {
  ExecutableIntegrationProcess,
  IntegrationActionAdapter,
} from "@/features/hr/integration/action-executor";
import type { IntegrationSimulation } from "@/features/hr/integration/engine";
import type { IntegrationBlock } from "@/features/hr/integration/schemas";
import type { HrAccess } from "@/features/hr/lib/server-access";
import { createManualTask } from "@/features/tasks/lib/server";
import type { ServerUserContext } from "@/lib/auth-server";
import { createAutentiqueDocument } from "@/lib/autentique.server";
import type { AutentiqueSignerInput } from "@/lib/autentique-core";
import { adminApp, dbAdmin } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import type { Task } from "@/types";

type FirestoreRecord = Record<string, unknown>;
type ProfileWritePolicy = IntegrationBlock["writePolicy"];

const TASK_ASSIGNEE_TYPES = new Set(["user", "profile", "role", "team", "unit"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const TASK_VISIBILITY_SCOPES = new Set([
  "assignee",
  "assignee_and_watchers",
  "unit",
  "project",
  "workspace",
]);

function record(value: unknown): FirestoreRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as FirestoreRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => text(item))
    .filter((item): item is string => Boolean(item));
  return values.length ? values : undefined;
}

function idempotencyKey(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part))
    .join("__")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 1200);
}

function dateAfterDays(now: string, days: unknown) {
  const parsedDays = number(days);
  if (parsedDays === null) return null;
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + Math.trunc(parsedDays));
  return date.toISOString().slice(0, 10);
}

function taskAssigneeType(value: unknown) {
  return TASK_ASSIGNEE_TYPES.has(String(value))
    ? (String(value) as Task["assigneeType"])
    : undefined;
}

function taskPriority(value: unknown) {
  return TASK_PRIORITIES.has(String(value))
    ? (String(value) as Task["priority"])
    : undefined;
}

function taskVisibilityScope(value: unknown) {
  return TASK_VISIBILITY_SCOPES.has(String(value))
    ? (String(value) as Task["visibilityScope"])
    : undefined;
}

function processString(processData: FirestoreRecord, keys: string[]) {
  for (const key of keys) {
    const value = text(processData[key]);
    if (value) return value;
  }
  return null;
}

function signatureSigners(
  value: unknown,
  processData: FirestoreRecord
): AutentiqueSignerInput[] {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const signers = source.reduce<AutentiqueSignerInput[]>((result, item) => {
      const signer = record(item);
      const email = text(signer.email) ?? (typeof item === "string" ? text(item) : null);
      const action = text(signer.action);
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) return result;
      result.push({
        email,
        action: ["SIGN", "SIGN_AS_A_WITNESS", "APPROVE", "RECOGNIZE"].includes(
          action ?? ""
        )
          ? (action as AutentiqueSignerInput["action"])
          : "SIGN",
      });
      return result;
    }, []);
  if (signers.length) return signers;

  const candidateEmail = processString(processData, ["candidateEmail", "email"]);
  return candidateEmail && /^\S+@\S+\.\S+$/.test(candidateEmail)
    ? [{ email: candidateEmail, action: "SIGN" }]
    : [];
}

function actorContextFromHrAccess(access: HrAccess): ServerUserContext {
  return {
    decoded: access.decoded,
    userDoc: access.userDoc,
    profileId: access.profileId,
    permissions: access.permissions,
    isDefaultAdmin: access.isDefaultAdmin,
    workspace_id: WORKSPACE_ID,
  };
}

export function buildIntegrationProcessContext(
  processId: string,
  processData: FirestoreRecord
) {
  return {
    onboardingId: processId,
    candidateId: processData.candidateId ?? null,
    candidateName: processData.candidateName ?? null,
    candidateEmail: processData.candidateEmail ?? null,
    employeeId: processData.employeeId ?? processData.collaboratorUserId ?? null,
    collaboratorUserId: processData.collaboratorUserId ?? null,
    roleId: processData.jobRoleId ?? null,
    roleName: processData.jobRoleName ?? null,
    functionId: processData.functionId ?? null,
    functionName: processData.functionName ?? null,
    unitId: processData.unitId ?? null,
    unitName: processData.unitName ?? null,
    expectedAdmissionDate: processData.expectedAdmissionDate ?? null,
    status: processData.status ?? null,
  };
}

function findBlock(execution: ExecutableIntegrationProcess, blockId: unknown) {
  const id = text(blockId);
  if (!id) return null;
  return execution.snapshot.blocks.find((block) => block.id === id) ?? null;
}

function profilePayload(fieldKey: string, value: unknown, block?: IntegrationBlock | null) {
  const variable = getDocumentVariable(fieldKey);
  const fieldType = variable?.fieldType ?? block?.type;
  if (fieldType === "currency") {
    const parsed = number(value);
    return parsed === null ? { value_text: String(value ?? "") } : { value_number: Math.round(parsed * 100) };
  }
  if (fieldType === "number" || block?.type === "number" || block?.type === "percentage") {
    const parsed = number(value);
    return parsed === null ? { value_text: String(value ?? "") } : { value_number: parsed };
  }
  if (fieldType === "date" || block?.type === "date" || block?.type === "datetime") {
    return { value_date: value };
  }
  if (fieldType === "boolean" || block?.type === "yes_no" || block?.type === "confirmation") {
    const parsed = bool(value);
    return parsed === null ? { value_text: String(value ?? "") } : { value_boolean: parsed };
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return { value_json: value };
  }
  return { value_text: String(value ?? "") };
}

async function writeProfileValue(params: {
  processId: string;
  processData: FirestoreRecord;
  actorId: string;
  actorName: string;
  now: string;
  fieldKey: string;
  value: unknown;
  policy: ProfileWritePolicy;
  block?: IntegrationBlock | null;
}) {
  const employeeId = processString(params.processData, [
    "employeeId",
    "collaboratorUserId",
  ]);
  if (params.fieldKey === "employee.personal_email") {
    return {
      employeeId: employeeId ?? null,
      fieldKey: params.fieldKey,
      status: "managed_by_access_account",
    };
  }
  const requestId = idempotencyKey([
    "integration_profile_update",
    params.processId,
    params.block?.id ?? params.fieldKey,
  ]);
  const payload = profilePayload(params.fieldKey, params.value, params.block);

  if (!employeeId || params.policy === "confirm" || params.policy === "approval") {
    const status = !employeeId
      ? "pending_employee_creation"
      : params.policy === "approval"
        ? "pending_approval"
        : "pending_confirmation";
    await hrDbAdmin.collection("hrProfileUpdateRequests").doc(requestId).set(
      {
        type: "integration_profile_update",
        status,
        onboardingId: params.processId,
        employeeId: employeeId ?? null,
        fieldKey: params.fieldKey,
        blockId: params.block?.id ?? null,
        blockLabel: params.block?.label ?? null,
        writePolicy: params.policy,
        value: params.value,
        valuePayload: payload,
        requestedBy: params.actorId,
        requestedByName: params.actorName,
        requestedAt: params.now,
        updatedAt: params.now,
      },
      { merge: true }
    );
    return { requestId, status };
  }

  const updatedAt = Timestamp.now();
  const employeeRef = hrDbAdmin.collection("employees").doc(employeeId);
  await employeeRef.collection("field_values").doc(params.fieldKey).set(
    {
      field_key: params.fieldKey,
      ...payload,
      updated_at: updatedAt,
      updated_by: params.actorId,
      updated_by_name: params.actorName,
      source: "integration_v2",
      onboardingId: params.processId,
      blockId: params.block?.id ?? null,
    },
    { merge: true }
  );

  const employeePatch: FirestoreRecord = { updated_at: updatedAt };
  const userPatch: FirestoreRecord = { updatedAt: params.now };
  if (params.fieldKey === "employee.name" && typeof params.value === "string") {
    employeePatch.name = params.value;
    userPatch.username = params.value;
  }
  if (params.fieldKey === "employee.has_vt" && typeof params.value === "boolean") {
    userPatch.needsTransportVoucher = params.value;
  }
  if (params.fieldKey === "employee.vt_daily_value") {
    const parsed = number(params.value);
    if (parsed !== null) userPatch.transportVoucherValue = parsed;
  }
  await employeeRef.set(employeePatch, { merge: true });
  await dbAdmin.collection("users").doc(employeeId).set(userPatch, { merge: true });
  return { employeeId, fieldKey: params.fieldKey, status: "applied" };
}

function assigneeFromConfig(input: FirestoreRecord, processData: FirestoreRecord) {
  const assignee = record(input.assignee);
  const strategy = text(assignee.strategy) ?? text(input.assigneeStrategy);
  const configuredType = taskAssigneeType(input.assigneeType ?? assignee.type);
  const configuredId =
    text(input.assigneeId) ?? text(assignee.id) ?? text(assignee.referenceId);

  if (configuredType && configuredId) {
    return { assigneeType: configuredType, assigneeId: configuredId };
  }
  if (strategy === "employee") {
    const employeeId = processString(processData, ["employeeId", "collaboratorUserId"]);
    if (employeeId) return { assigneeType: "user" as const, assigneeId: employeeId };
  }
  if (strategy === "unit_manager") {
    const managerId = processString(processData, ["unitManagerId", "managerId"]);
    if (managerId) return { assigneeType: "user" as const, assigneeId: managerId };
  }
  if (strategy === "specific_user" && configuredId) {
    return { assigneeType: "user" as const, assigneeId: configuredId };
  }
  if ((strategy === "profile" || strategy === "job_role") && configuredId) {
    return { assigneeType: "role" as const, assigneeId: configuredId };
  }
  if (strategy === "job_function" && configuredId) {
    return { assigneeType: "team" as const, assigneeId: configuredId };
  }
  return {};
}

export function createIntegrationActionAdapter(params: {
  access: HrAccess;
  execution: ExecutableIntegrationProcess;
  processId: string;
  processData: FirestoreRecord;
  now: string;
}): IntegrationActionAdapter {
  const context = actorContextFromHrAccess(params.access);
  const processContext = buildIntegrationProcessContext(params.processId, params.processData);
  const includeSensitive =
    params.access.isDefaultAdmin ||
    params.access.permissions.settings?.manageUsers === true;

  return {
    async createTask(input) {
      const data = record(input);
      const title =
        text(data.title) ??
        `Integração: ${String(params.processData.candidateName ?? params.processId)}`;
      const task = await createManualTask({
        context,
        input: {
          title,
          ...(text(data.description) ? { description: text(data.description)! } : {}),
          ...assigneeFromConfig(data, params.processData),
          ...(bool(data.requiresApproval) !== null
            ? { requiresApproval: bool(data.requiresApproval)! }
            : {}),
          ...(taskAssigneeType(data.approverType)
            ? { approverType: taskAssigneeType(data.approverType) }
            : {}),
          ...(text(data.approverId) ? { approverId: text(data.approverId)! } : {}),
          ...(text(data.dueDate)
            ? { dueDate: text(data.dueDate)! }
            : dateAfterDays(params.now, data.dueDays)
              ? { dueDate: dateAfterDays(params.now, data.dueDays)! }
              : {}),
          ...(text(data.projectId) ? { projectId: text(data.projectId)! } : {}),
          ...(text(data.subprojectId) ? { subprojectId: text(data.subprojectId)! } : {}),
          ...(text(data.subprojectName)
            ? { subprojectName: text(data.subprojectName)! }
            : { subprojectName: "Integração" }),
          ...(processString(params.processData, ["unitId"])
            ? { unitId: processString(params.processData, ["unitId"])! }
            : {}),
          ...(processString(params.processData, ["unitName"])
            ? { unitName: processString(params.processData, ["unitName"])! }
            : {}),
          ...(taskPriority(data.priority) ? { priority: taskPriority(data.priority) } : {}),
          ...(stringArray(data.watcherUserIds)
            ? { watcherUserIds: stringArray(data.watcherUserIds) }
            : {}),
          ...(stringArray(data.watcherProfileIds)
            ? { watcherProfileIds: stringArray(data.watcherProfileIds) }
            : {}),
          ...(stringArray(data.watcherRoleIds)
            ? { watcherRoleIds: stringArray(data.watcherRoleIds) }
            : {}),
          ...(taskVisibilityScope(data.visibilityScope)
            ? { visibilityScope: taskVisibilityScope(data.visibilityScope) }
            : {}),
          originLink:
            text(data.originLink) ??
            `/dashboard/hr/recruitment?onboardingId=${encodeURIComponent(
              params.processId
            )}`,
          origin: { kind: "manual" },
          idempotencyKey: idempotencyKey([
            WORKSPACE_ID,
            "integration_task",
            params.processId,
            text(data.ruleId),
            text(data.actionId),
          ]),
        },
      });
      return { taskId: task.id, title: task.title };
    },

    async notify(input) {
      const data = record(input);
      const notificationId = idempotencyKey([
        "integration_notification",
        params.processId,
        text(data.ruleId),
        text(data.actionId),
      ]);
      const ref = hrDbAdmin.collection("hrNotifications").doc(notificationId);
      const existing = await ref.get();
      if (!existing.exists) {
        await ref.set({
          type: "integration_action",
          status: "pending",
          onboardingId: params.processId,
          process: processContext,
          title: text(data.title) ?? "Notificacao de integracao",
          message: text(data.message) ?? text(data.description) ?? "",
          channels: stringArray(data.channels) ?? ["in_app"],
          recipient: data.recipient ?? data.assignee ?? null,
          ruleId: text(data.ruleId),
          actionId: text(data.actionId),
          createdAt: params.now,
          updatedAt: params.now,
          createdBy: params.access.decoded.uid,
          createdByName: params.access.actorName,
        });
      }
      return { notificationId };
    },

    async requestSignature(input) {
      const data = record(input);
      const requestId = idempotencyKey([
        "integration_signature",
        params.processId,
        text(data.ruleId),
        text(data.actionId),
      ]);
      const ref = hrDbAdmin.collection("hrSignatureRequests").doc(requestId);
      const existing = await ref.get();
      if (existing.exists) {
        return {
          signatureRequestId: requestId,
          status: existing.get("status") ?? "pending",
          providerDocumentId: existing.get("providerDocumentId") ?? null,
        };
      }

      let generatedDocumentId = text(data.generatedDocumentId);
      let storagePath = text(data.storagePath);
      let documentBuffer: Buffer | null = null;
      let missingRequired: string[] = [];
      let templateId = text(data.templateId) ?? text(data.documentTemplateId);
      if (!generatedDocumentId && templateId) {
        const generated = await generateDocumentFromTemplate({
          templateId,
          employeeId: processString(params.processData, ["employeeId", "collaboratorUserId"]),
          onboardingId: params.processId,
          includeSensitive,
          actorId: params.access.decoded.uid,
          actorName: params.access.actorName,
        });
        generatedDocumentId = generated.id;
        storagePath = generated.storagePath;
        documentBuffer = generated.buffer;
        missingRequired = generated.missingRequired;
      } else if (generatedDocumentId) {
        const generatedSnapshot = await dbAdmin
          .collection("generatedDocuments")
          .doc(generatedDocumentId)
          .get();
        if (!generatedSnapshot.exists) {
          throw new Error("Documento gerado não encontrado para assinatura.");
        }
        templateId = text(generatedSnapshot.get("templateId")) ?? templateId;
        storagePath = text(generatedSnapshot.get("storagePath")) ?? storagePath;
        missingRequired = stringArray(generatedSnapshot.get("missingRequired")) ?? [];
      }

      const provider = text(data.provider) ?? "internal";
      const signers = signatureSigners(data.signers ?? data.signer, params.processData);
      let templateName: string | null = null;
      if (templateId) {
        const templateSnapshot = await dbAdmin
          .collection("companyDocumentTemplates")
          .doc(templateId)
          .get();
        templateName = templateSnapshot.exists ? text(templateSnapshot.get("name")) : null;
      }
      const documentName = buildSignatureDocumentName({
        documentType:
          text(data.documentTypeName) ??
          text(data.documentType) ??
          text(data.documentName) ??
          templateName,
        holderName: processString(params.processData, [
          "candidateName",
          "employeeName",
          "collaboratorName",
          "name",
        ]),
      });
      const baseRequest = {
        type: "integration_document_signature",
        status: provider === "autentique" ? "sending" : "pending",
        onboardingId: params.processId,
        process: processContext,
        templateId,
        generatedDocumentId,
        storagePath,
        documentName,
        signers,
        dueDate: text(data.dueDate) ?? dateAfterDays(params.now, data.dueDays),
        provider,
        ruleId: text(data.ruleId),
        actionId: text(data.actionId),
        requestedAt: params.now,
        requestedBy: params.access.decoded.uid,
        requestedByName: params.access.actorName,
        updatedAt: params.now,
      };
      await ref.set(baseRequest);

      if (provider !== "autentique") {
        return { signatureRequestId: requestId, generatedDocumentId, storagePath };
      }
      try {
        if (!generatedDocumentId || !storagePath) {
          throw new Error("A assinatura no Autentique exige um documento gerado.");
        }
        if (missingRequired.length) {
          throw new Error(
            `Documento incompleto. Preencha as variáveis obrigatórias: ${missingRequired.join(", ")}.`
          );
        }
        if (!signers.length) {
          throw new Error("Nenhum e-mail válido foi informado para o signatário.");
        }
        if (!documentBuffer) {
          const bucket = getStorage(adminApp).bucket(firebaseClientConfig.storageBucket);
          [documentBuffer] = await bucket.file(storagePath).download();
        }
        const created = await createAutentiqueDocument({
          buffer: documentBuffer,
          fileName: buildSignatureFileName(documentName),
          documentName,
          message: text(data.message),
          signers,
        });
        await ref.set(
          {
            status: "sent",
            sandbox: created.sandbox,
            providerDocumentId: created.document.id,
            providerDocumentName: created.document.name,
            providerCreatedAt: created.document.created_at,
            providerSignatures: created.document.signatures,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        return {
          signatureRequestId: requestId,
          generatedDocumentId,
          storagePath,
          providerDocumentId: created.document.id,
          sandbox: created.sandbox,
          status: "sent",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao enviar ao Autentique.";
        await ref.set(
          { status: "failed", error: message, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        throw error;
      }
    },

    async generateDocument(input) {
      const data = record(input);
      const templateId = text(data.templateId) ?? text(data.documentTemplateId);
      if (!templateId) throw new Error("A acao de documento precisa de templateId.");
      const generated = await generateDocumentFromTemplate({
        templateId,
        employeeId: processString(params.processData, ["employeeId", "collaboratorUserId"]),
        onboardingId: params.processId,
        includeSensitive,
        actorId: params.access.decoded.uid,
        actorName: params.access.actorName,
      });
      return {
        generatedDocumentId: generated.id,
        storagePath: generated.storagePath,
        missingRequired: generated.missingRequired,
      };
    },

    async updateProfile(input) {
      const data = record(input);
      const block = findBlock(params.execution, data.targetId);
      const fieldKey =
        text(data.fieldKey) ?? text(data.variableKey) ?? text(block?.variableKey);
      if (!fieldKey) throw new Error("Atualizacao de perfil sem variableKey.");
      const value =
        Object.prototype.hasOwnProperty.call(data, "value")
          ? data.value
          : block
            ? params.execution.answers[block.id]
            : undefined;
      return writeProfileValue({
        processId: params.processId,
        processData: params.processData,
        actorId: params.access.decoded.uid,
        actorName: params.access.actorName,
        now: params.now,
        fieldKey,
        value,
        policy: "direct",
        block,
      });
    },
  };
}

export async function syncIntegrationProfileWrites(params: {
  execution: ExecutableIntegrationProcess;
  simulation: IntegrationSimulation;
  processId: string;
  processData: FirestoreRecord;
  access: HrAccess;
  now: string;
}) {
  const visible = new Set(params.simulation.visibleBlockIds);
  const writes: Record<string, Record<string, unknown>> = {};

  for (const block of params.execution.snapshot.blocks) {
    if (!visible.has(block.id)) continue;
    if (!block.variableKey || block.writePolicy === "process_only") continue;
    if (!Object.prototype.hasOwnProperty.call(params.execution.answers, block.id)) continue;
    const output = await writeProfileValue({
      processId: params.processId,
      processData: params.processData,
      actorId: params.access.decoded.uid,
      actorName: params.access.actorName,
      now: params.now,
      fieldKey: block.variableKey,
      value: params.execution.answers[block.id],
      policy: block.writePolicy,
      block,
    });
    writes[block.id] = output;
  }

  return writes;
}
