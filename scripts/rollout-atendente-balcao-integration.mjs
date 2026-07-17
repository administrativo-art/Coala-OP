import fs from "node:fs";
import { cert, deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const PROCESS_ID = "AuN2P9qU5GMQRGvVLc86";
const ROLE_ID = "xwihJDpc8eGsTNDIebOc";
const FUNCTION_ID = "sWhvS4l2SvyY640n8OIC";
const TEMPLATE_ID = `atendente_balcao_v2_${FUNCTION_ID}`;
const ACTOR_ID = "system:rollout:atendente-balcao-integration";
const ACTOR_NAME = "Rollout modelo Atendente de balcão";
const SCHEMA_VERSION = "coala-integration-v1";

const PROBATION_CONFIG = {
  firstPeriodDays: 45,
  secondPeriodDays: 45,
  evaluationWindowDays: 10,
  alertsBeforeDays: [10, 5, 1],
  extensionTermRequired: true,
  evaluator: { strategy: "direct_manager", fallback: "hr_pool" },
  effectivenessRule: "manual",
};

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
const app =
  getApps().find((item) => item.name === "rollout-atendente-balcao-integration") ??
  initializeApp({ credential: cert(serviceAccount) }, "rollout-atendente-balcao-integration");
const db = getFirestore(app, "coala-rh");
const now = new Date().toISOString();

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pruneUndefined(value) {
  if (Array.isArray(value)) return value.map(pruneUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, pruneUndefined(entry)]),
  );
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

function dateOnly(value) {
  const raw = text(value)?.slice(0, 10);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function parseDateOnly(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Data inválida: ${value}`);
  }
  return date;
}

function addDays(value, days) {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildPeriod(startDate, days, evaluationWindowDays) {
  const endDate = addDays(startDate, days - 1);
  return {
    days,
    startDate,
    endDate,
    evaluationStartDate: addDays(endDate, -(evaluationWindowDays - 1)),
    evaluationEndDate: endDate,
  };
}

function buildProbationSchedule(admissionDate, config) {
  const firstPeriod = buildPeriod(admissionDate, config.firstPeriodDays, config.evaluationWindowDays);
  const secondPeriod =
    config.secondPeriodDays > 0
      ? buildPeriod(addDays(firstPeriod.endDate, 1), config.secondPeriodDays, config.evaluationWindowDays)
      : null;
  return {
    admissionDate,
    totalDays: config.firstPeriodDays + config.secondPeriodDays,
    firstPeriod,
    secondPeriod,
    finalEndDate: secondPeriod?.endDate ?? firstPeriod.endDate,
  };
}

function targetStages() {
  return [
    {
      id: "formalizacao_coleta_dados",
      label: "Formalização · Coleta de dados",
      description: "Coleta de dados e documentos do candidato.",
      order: 0,
      required: true,
      skippable: false,
      dueDays: 3,
      dueDateSource: "stage_entry",
    },
    {
      id: "formalizacao_conferencia",
      label: "Formalização · Conferência",
      description: "Conferência dos dados e documentos pelo RH.",
      order: 1,
      required: true,
      skippable: false,
      dueDays: 2,
      dueDateSource: "stage_entry",
    },
    {
      id: "formalizacao_assinatura_documentos",
      label: "Formalização · Assinatura dos documentos",
      description: "Geração, envio e acompanhamento das assinaturas dos documentos.",
      order: 2,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    },
    {
      id: "formalizacao_acessos",
      label: "Formalização · Acessos",
      description: "Cadastro do colaborador e dos acessos nos sistemas.",
      order: 3,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    },
    {
      id: "formalizacao_finalizacao",
      label: "Formalização · Finalização",
      description: "Fechamento da formalização antes do treinamento.",
      order: 4,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    },
    {
      id: "treinamento",
      label: "Treinamento",
      description: "Fase reservada para a estruturação futura das etapas de treinamento.",
      order: 5,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    },
    {
      id: "finalizacao",
      label: "Finalização",
      description: "Conclusão do onboard.",
      order: 6,
      required: true,
      skippable: false,
      dueDays: null,
      dueDateSource: "stage_entry",
    },
  ];
}

function refreshProbation(state, today) {
  if (!state.schedule || state.status === "effective" || state.status === "terminated") return state;
  const evaluations = state.evaluations.map((evaluation) =>
    evaluation.status === "completed"
      ? evaluation
      : {
          ...evaluation,
          status:
            today < evaluation.windowStartDate
              ? "scheduled"
              : today <= evaluation.windowEndDate
                ? "available"
                : "overdue",
        },
  );
  const alerts = state.alerts.map((alert) =>
    alert.status === "sent"
      ? alert
      : { ...alert, status: today >= alert.dueDate ? "due" : "scheduled" },
  );
  const allCompleted = evaluations.length > 0 && evaluations.every((evaluation) => evaluation.status === "completed");
  let status = state.status;
  if (allCompleted || today > state.schedule.finalEndDate) status = "decision_pending";
  if (
    state.config.effectivenessRule === "approved_evaluations" &&
    allCompleted &&
    evaluations.every((evaluation) => evaluation.result === "approved")
  ) {
    status = "effective";
  }
  if (state.config.effectivenessRule === "automatic_at_end" && today > state.schedule.finalEndDate) {
    status = "effective";
  }
  return { ...state, status, evaluations, alerts };
}

function createProbationProcess(admissionDate, config, timestamp) {
  if (!admissionDate) {
    return {
      status: "awaiting_admission",
      admissionDate: null,
      config,
      schedule: null,
      evaluations: [],
      alerts: [],
      extensionTerm: { required: config.extensionTermRequired && config.secondPeriodDays > 0, generatedDocumentId: null, signedAt: null },
      decision: { result: null, decidedAt: null, decidedBy: null, notes: null },
      updatedAt: timestamp,
    };
  }
  const schedule = buildProbationSchedule(admissionDate, config);
  const periods = [
    { id: "first", label: "Avaliação do primeiro período", period: schedule.firstPeriod },
    ...(schedule.secondPeriod
      ? [{ id: "second", label: "Avaliação da prorrogação", period: schedule.secondPeriod }]
      : []),
  ];
  const evaluations = periods.map(({ id, label, period }) => ({
    id,
    label,
    windowStartDate: period.evaluationStartDate,
    windowEndDate: period.evaluationEndDate,
    status: "scheduled",
    completedAt: null,
    completedBy: null,
    result: null,
    notes: null,
  }));
  const alerts = periods.flatMap(({ id, period }) =>
    config.alertsBeforeDays.map((days) => ({
      id: `${id}_${days}`,
      evaluationId: id,
      dueDate: addDays(period.evaluationEndDate, -days),
      status: "scheduled",
      sentAt: null,
    })),
  );
  return refreshProbation(
    {
      status: "active",
      admissionDate,
      config,
      schedule,
      evaluations,
      alerts,
      extensionTerm: { required: config.extensionTermRequired && config.secondPeriodDays > 0, generatedDocumentId: null, signedAt: null },
      decision: { result: null, decidedAt: null, decidedBy: null, notes: null },
      updatedAt: timestamp,
    },
    timestamp.slice(0, 10),
  );
}

function normalizeStages() {
  return targetStages();
}

function legacyVisibleStages() {
  return [
    {
      id: "documents",
      label: "Formalização · Coleta de dados",
      order: 0,
      required: true,
      dueDays: 3,
    },
    {
      id: "document_review",
      label: "Formalização · Conferência",
      order: 1,
      required: true,
      dueDays: 2,
    },
    {
      id: "signature",
      label: "Formalização · Assinatura dos documentos",
      order: 2,
      required: true,
      dueDays: null,
    },
    {
      id: "integration",
      label: "Formalização · Acessos",
      order: 3,
      required: true,
      dueDays: null,
    },
    {
      id: "formalization_validation",
      label: "Formalização · Finalização",
      order: 4,
      required: true,
      dueDays: null,
    },
    {
      id: "probation",
      label: "Treinamento",
      order: 5,
      required: true,
      dueDays: null,
    },
    {
      id: "done",
      label: "Finalização",
      order: 6,
      required: true,
      dueDays: null,
    },
  ];
}

function resolveLegacyCurrentStage(processData, stages) {
  const ids = new Set(stages.map((stage) => stage.id));
  if (ids.has(processData.currentStage)) return processData.currentStage;
  if (processData.currentStage === "signature_preparation") return "signature";
  return stages[0]?.id ?? null;
}

function documentBlocks(stages, processData) {
  const documentStageId = stages.find((stage) => stage.id === "formalizacao_coleta_dados")?.id ?? stages[0].id;
  const documents = Array.isArray(processData.documents) ? processData.documents : [];
  return documents
    .slice()
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
    .map((document, order) => ({
      id: `upload_${safeId(document.id || order)}`,
      stageId: documentStageId,
      order,
      type: "upload",
      label: String(document.label || `Documento ${order + 1}`),
      description: text(document.description) ?? undefined,
      required: document.required !== false,
      readOnly: false,
      active: true,
      writePolicy: "process_only",
      hiddenAnswerPolicy: "exclude",
      config: {
        accept: document.documentTypeCode === "PROFILE_PHOTO" ? ".jpg,.jpeg,.png" : ".pdf,.jpg,.jpeg,.png",
        approvalRequired: true,
        legacyDocumentTypeCode: text(document.documentTypeCode),
      },
    }));
}

function buildContent(processData) {
  const stages = normalizeStages();
  const blocks = documentBlocks(stages, processData);
  return { stages, blocks, rules: [], probation: PROBATION_CONFIG, completionRules: [] };
}

function buildStageStatuses(stages, currentStageId) {
  const currentIndex = Math.max(0, stages.findIndex((stage) => stage.id === currentStageId));
  return Object.fromEntries(
    stages.map((stage, index) => [
      stage.id,
      index < currentIndex ? "completed" : index === currentIndex ? "active" : "pending",
    ]),
  );
}

function buildUploads(processData) {
  const uploads = {};
  for (const document of Array.isArray(processData.documents) ? processData.documents : []) {
    if (!document.fileUrl && !document.filePath) continue;
    uploads[`upload_${safeId(document.id)}`] = {
      status: document.status === "approved" ? "approved" : "uploaded",
      url: document.fileUrl ?? null,
      path: document.filePath ?? null,
      name: document.fileName ?? document.label ?? document.id,
      receivedAt: document.receivedAt ?? null,
      approvedAt: document.approvedAt ?? null,
    };
  }
  return uploads;
}

const processRef = db.collection("onboardingProcesses").doc(PROCESS_ID);
const templateRef = db.collection("onboardingTemplates").doc(TEMPLATE_ID);
const versionRef = templateRef.collection("versions").doc("v000001");

const [processSnap, roleSnap, functionSnap, existingTemplateSnap, peerTemplatesSnap] = await Promise.all([
  processRef.get(),
  db.collection("jobRoles").doc(ROLE_ID).get(),
  db.collection("jobFunctions").doc(FUNCTION_ID).get(),
  templateRef.get(),
  db.collection("onboardingTemplates").where("roleId", "==", ROLE_ID).get(),
]);

if (!processSnap.exists) throw new Error(`Processo ${PROCESS_ID} não encontrado.`);
if (!roleSnap.exists) throw new Error(`Cargo ${ROLE_ID} não encontrado.`);
if (!functionSnap.exists) throw new Error(`Função ${FUNCTION_ID} não encontrada.`);

const processData = processSnap.data();
if (processData.jobRoleId !== ROLE_ID || processData.functionId !== FUNCTION_ID) {
  throw new Error(`Processo não pertence ao cargo/função esperados: ${processData.jobRoleId}/${processData.functionId}.`);
}

const compatibleRoleIds = Array.isArray(functionSnap.get("compatibleRoleIds"))
  ? functionSnap.get("compatibleRoleIds").filter((value) => typeof value === "string")
  : [];
if (compatibleRoleIds.length && !compatibleRoleIds.includes(ROLE_ID)) {
  throw new Error("Função Atendente de balcão não é compatível com o cargo do processo.");
}

const content = buildContent(processData);
const modelName = "Integração · Atendente de quiosque · Atendente de balcão";
const modelDescription = `Modelo criado a partir da integração em andamento de ${processData.candidateName ?? PROCESS_ID}, incluindo período de experiência.`;
const version = {
  schemaVersion: SCHEMA_VERSION,
  templateId: TEMPLATE_ID,
  version: 1,
  name: modelName,
  description: modelDescription,
  roleId: ROLE_ID,
  functionId: FUNCTION_ID,
  ...content,
  createdAt: now,
  createdBy: ACTOR_ID,
  publishedAt: now,
};
const cleanVersion = pruneUndefined(version);
const visibleStages = legacyVisibleStages();
const legacyCurrentStage = resolveLegacyCurrentStage(processData, visibleStages);
const currentStageId = content.stages.some((stage) => stage.id === processData.currentStage)
  ? processData.currentStage
  : processData.currentStage === "documents"
    ? "formalizacao_coleta_dados"
    : processData.currentStage === "document_review"
      ? "formalizacao_conferencia"
      : processData.currentStage === "formalization_validation"
        ? "formalizacao_assinatura_documentos"
        : processData.currentStage === "integration"
          ? "formalizacao_acessos"
          : content.stages[0]?.id ?? null;
const integrationV2 = {
  mode: "import",
  templateId: TEMPLATE_ID,
  templateVersion: 1,
  snapshot: cleanVersion,
  answers: {},
  uploads: buildUploads(processData),
  stageStatuses: buildStageStatuses(content.stages, currentStageId),
  currentStageId,
  startedAt: processData.createdAt ?? now,
  updatedAt: now,
  assignees: {},
  actionResults: {},
  optionFilters: {},
  completionRequestedAt: null,
};
const admissionDate = dateOnly(processData.expectedAdmissionDate);
const probationV2 = createProbationProcess(admissionDate, PROBATION_CONFIG, now);
const peersToUnset = peerTemplatesSnap.docs
  .filter((doc) => doc.id !== TEMPLATE_ID)
  .filter((doc) => (doc.get("functionId") ?? null) === FUNCTION_ID && doc.get("isDefault") === true)
  .map((doc) => doc.id);

const summary = {
  apply: APPLY,
  process: {
    id: PROCESS_ID,
    candidateName: processData.candidateName ?? null,
    status: processData.status ?? null,
    currentStage: processData.currentStage ?? null,
    legacyCurrentStage,
    hadIntegrationV2: Boolean(processData.integrationV2?.snapshot),
    visibleStages: visibleStages.map((stage) => stage.id),
  },
  template: {
    id: TEMPLATE_ID,
    exists: existingTemplateSnap.exists,
    name: modelName,
    roleId: ROLE_ID,
    functionId: FUNCTION_ID,
    stages: content.stages.map((stage) => stage.id),
    blocks: content.blocks.length,
    probation: PROBATION_CONFIG,
    peersToUnset,
  },
  probationV2: {
    admissionDate: probationV2.admissionDate,
    status: probationV2.status,
    finalEndDate: probationV2.schedule?.finalEndDate ?? null,
    evaluations: probationV2.evaluations.map((evaluation) => ({
      id: evaluation.id,
      windowStartDate: evaluation.windowStartDate,
      windowEndDate: evaluation.windowEndDate,
      status: evaluation.status,
    })),
  },
};
console.log(JSON.stringify(summary, null, 2));

if (APPLY) {
  await db.runTransaction(async (transaction) => {
    const [freshProcess, freshTemplate, freshVersion] = await Promise.all([
      transaction.get(processRef),
      transaction.get(templateRef),
      transaction.get(versionRef),
    ]);
    if (!freshProcess.exists) throw new Error("Processo deixou de existir.");
    if (freshProcess.get("integrationV2.snapshot")) {
      const templateId = freshProcess.get("integrationV2.templateId");
      if (templateId !== TEMPLATE_ID) {
        throw new Error(`Processo já possui integrationV2 com outro modelo: ${templateId}.`);
      }
    }
    if (freshTemplate.exists && freshTemplate.get("rolloutSourceProcessId") !== PROCESS_ID) {
      throw new Error(`Template ${TEMPLATE_ID} já existe e não foi criado por este rollout.`);
    }
    if (freshVersion.exists && freshVersion.get("templateId") !== TEMPLATE_ID) {
      throw new Error("Versão v000001 existente não pertence a este modelo.");
    }

    for (const peerId of peersToUnset) {
      transaction.update(db.collection("onboardingTemplates").doc(peerId), { isDefault: false, updatedAt: now });
    }

    transaction.set(templateRef, {
      name: modelName,
      description: modelDescription,
      roleId: ROLE_ID,
      functionId: FUNCTION_ID,
      isDefault: true,
      status: "published",
      currentVersion: 1,
      hasDraft: false,
      rolloutSourceProcessId: PROCESS_ID,
      createdAt: freshTemplate.get("createdAt") ?? now,
      createdBy: freshTemplate.get("createdBy") ?? ACTOR_ID,
      createdByName: freshTemplate.get("createdByName") ?? ACTOR_NAME,
      updatedAt: now,
      updatedBy: ACTOR_ID,
      updatedByName: ACTOR_NAME,
      publishedAt: now,
      archivedAt: null,
    }, { merge: true });
    transaction.set(versionRef, cleanVersion, { merge: true });
    transaction.update(processRef, {
      stages: visibleStages,
      currentStage: legacyCurrentStage,
      integrationV2,
      probationV2,
      updatedAt: now,
    });
  });
  console.log("Rollout aplicado.");
} else {
  console.log("Dry-run concluído. Execute novamente com --apply para aplicar.");
}

await deleteApp(app);
