export const ACCOUNTANT_REGISTRY_MAX_FILE_SIZE = 15 * 1024 * 1024;

type RegistryUploadProcess = Record<string, unknown>;

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function validateAccountantRegistryPdf(input: {
  mimeType: string;
  size: number;
  bytes: Uint8Array;
}) {
  if (input.mimeType !== "application/pdf") {
    return { ok: false as const, error: "Envie a ficha de registro em PDF." };
  }
  if (input.size <= 0 || input.size > ACCOUNTANT_REGISTRY_MAX_FILE_SIZE) {
    return { ok: false as const, error: "O arquivo deve ter até 15 MB." };
  }
  const bytes = input.bytes;
  const hasPdfSignature = bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
  if (!hasPdfSignature) {
    return { ok: false as const, error: "O arquivo enviado não é um PDF válido." };
  }
  return { ok: true as const };
}

export function accountantRhRegistryUploadPreflight(process: RegistryUploadProcess) {
  const workflow = record(process.accountantWorkflow);
  const currentRegistry = record(workflow.registryDocument);
  if (text(currentRegistry.status, 30) === "approved" && text(workflow.status, 40) === "completed") {
    return { ok: true as const, unchanged: true as const };
  }
  if (text(process.currentStage, 80) !== "accountant") {
    return {
      ok: false as const,
      status: 409 as const,
      error: "A Ficha de Registro só pode ser anexada enquanto a etapa do contador estiver em andamento.",
    };
  }
  if (text(currentRegistry.storagePath, 1500) && text(currentRegistry.status, 30) !== "rejected") {
    return {
      ok: false as const,
      status: 409 as const,
      error: "Uma ficha já foi recebida. Revise o documento existente antes de enviar outro arquivo.",
    };
  }

  const latestFormId = text(workflow.latestFormId, 180);
  const formValidation = record(workflow.formValidation);
  const documentSelection = record(workflow.documentSelection);
  const emailSent = Boolean(text(record(workflow.email).sentAt, 40));
  const priorStepsCompleted = Boolean(
    latestFormId
    && text(formValidation.documentId, 180) === latestFormId
    && (emailSent || text(documentSelection.documentId, 180) === latestFormId),
  );
  if (!priorStepsCompleted) {
    return {
      ok: false as const,
      status: 409 as const,
      error: "Conclua a revisão do formulário e a seleção dos documentos antes de anexar a ficha.",
    };
  }
  return { ok: true as const, unchanged: false as const };
}
