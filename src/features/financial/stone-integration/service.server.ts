import "server-only";

import { randomUUID } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import {
  normalizeStoneMappingCodes,
  stoneMappingsOverlap,
  type StoneMerchantMapping,
  type StoneMerchantMappingDraft,
} from "./types";

const MAX_MAPPINGS = 100;

export class StoneIntegrationConfigurationError extends Error {
  constructor(
    readonly code: "LIMIT" | "NOT_FOUND" | "MAPPING_CONFLICT" | "KIOSK_NOT_FOUND" | "ACCOUNT_NOT_FOUND" | "CURSOR_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "StoneIntegrationConfigurationError";
  }
}

function runCursor(createdAtMillis: number, id: string) {
  return Buffer.from(JSON.stringify({ createdAtMillis, id }), "utf8").toString("base64url");
}

function parseRunCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!Number.isSafeInteger(parsed.createdAtMillis) || typeof parsed.id !== "string" || !parsed.id) throw new Error("invalid");
    return { createdAt: Timestamp.fromMillis(Number(parsed.createdAtMillis)), id: parsed.id };
  } catch {
    throw new StoneIntegrationConfigurationError("CURSOR_INVALID", "O cursor das execuções é inválido.");
  }
}

function timestampMillis(value: unknown) {
  if (typeof (value as { toMillis?: unknown })?.toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function mappingFromDocument(document: FirebaseFirestore.QueryDocumentSnapshot) {
  return { id: document.id, ...document.data() } as StoneMerchantMapping;
}

export async function listStoneIntegrationConfiguration(input: {
  workspaceId: string;
  cursor?: string;
  limit: number;
}) {
  const cursor = parseRunCursor(input.cursor);
  let runsQuery: FirebaseFirestore.Query = financialDbAdmin.collection("stoneIngestionRuns")
    .where("workspaceId", "==", input.workspaceId)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  if (cursor) runsQuery = runsQuery.startAfter(cursor.createdAt, cursor.id);

  const [mappingsSnapshot, runsSnapshot] = await Promise.all([
    financialDbAdmin.collection("stoneMerchantMappings")
      .where("workspaceId", "==", input.workspaceId)
      .orderBy(FieldPath.documentId())
      .limit(MAX_MAPPINGS + 1)
      .get(),
    runsQuery.limit(input.limit + 1).get(),
  ]);
  if (mappingsSnapshot.size > MAX_MAPPINGS) {
    throw new StoneIntegrationConfigurationError("LIMIT", "O workspace ultrapassou o limite de 100 mapeamentos Stone.");
  }
  const hasMore = runsSnapshot.size > input.limit;
  const runs = runsSnapshot.docs.slice(0, input.limit);
  const last = runs.at(-1);
  const lastCreatedAtMillis = last ? timestampMillis(last.data().createdAt) : null;

  return serializeFinancialValue({
    mappings: mappingsSnapshot.docs.map(mappingFromDocument),
    runs: runs.map((document) => ({ id: document.id, ...document.data() })),
    nextCursor: hasMore && last && lastCreatedAtMillis !== null
      ? runCursor(lastCreatedAtMillis, last.id)
      : null,
    stats: {
      mappingDocuments: mappingsSnapshot.size,
      runDocuments: runsSnapshot.size,
    },
  });
}

async function assertMappingReferences(workspaceId: string, draft: StoneMerchantMappingDraft) {
  const [kioskSnapshot, accountSnapshot] = await Promise.all([
    dbAdmin.collection("kiosks").doc(draft.kioskId).get(),
    financialDbAdmin.collection("bankAccounts").doc(draft.accountId).get(),
  ]);
  if (!kioskSnapshot.exists) {
    throw new StoneIntegrationConfigurationError("KIOSK_NOT_FOUND", "A unidade canônica não foi encontrada.");
  }
  if (!accountSnapshot.exists || accountSnapshot.data()?.active === false) {
    throw new StoneIntegrationConfigurationError("ACCOUNT_NOT_FOUND", "A conta Stone ativa não foi encontrada.");
  }
  const accountWorkspaceId = accountSnapshot.data()?.workspaceId;
  if (accountWorkspaceId !== undefined && accountWorkspaceId !== workspaceId) {
    throw new StoneIntegrationConfigurationError("ACCOUNT_NOT_FOUND", "A conta não pertence ao workspace atual.");
  }
  return {
    kioskName: String(kioskSnapshot.data()?.name || draft.kioskId),
    accountName: String(accountSnapshot.data()?.name || draft.accountId),
  };
}

export async function saveStoneMerchantMapping(input: {
  workspaceId: string;
  mappingId?: string;
  draft: StoneMerchantMappingDraft;
  reason: string;
  actor: { id: string; name: string | null; email: string | null };
}) {
  const names = await assertMappingReferences(input.workspaceId, input.draft);
  const mappingId = input.mappingId ?? `stone_mapping_${randomUUID()}`;
  const mappingRef = financialDbAdmin.collection("stoneMerchantMappings").doc(mappingId);
  const mappingsQuery = financialDbAdmin.collection("stoneMerchantMappings")
    .where("workspaceId", "==", input.workspaceId)
    .orderBy(FieldPath.documentId())
    .limit(MAX_MAPPINGS + 1);
  const normalizedDraft: StoneMerchantMappingDraft = {
    ...input.draft,
    stoneCodes: normalizeStoneMappingCodes(input.draft.stoneCodes),
    terminalIds: normalizeStoneMappingCodes(input.draft.terminalIds),
  };

  const saved = await financialDbAdmin.runTransaction(async (transaction) => {
    const mappingsSnapshot = await transaction.get(mappingsQuery);
    if (mappingsSnapshot.size > MAX_MAPPINGS || (!input.mappingId && mappingsSnapshot.size >= MAX_MAPPINGS)) {
      throw new StoneIntegrationConfigurationError("LIMIT", "O workspace atingiu o limite de 100 mapeamentos Stone.");
    }
    const currentDocument = mappingsSnapshot.docs.find((document) => document.id === mappingId);
    if (input.mappingId && !currentDocument) {
      throw new StoneIntegrationConfigurationError("NOT_FOUND", "O mapeamento Stone não foi encontrado.");
    }
    const candidate: StoneMerchantMapping = {
      id: mappingId,
      workspaceId: input.workspaceId,
      kioskName: names.kioskName,
      accountName: names.accountName,
      ...normalizedDraft,
    };
    const overlap = mappingsSnapshot.docs
      .filter((document) => document.id !== mappingId)
      .map(mappingFromDocument)
      .find((mapping) => stoneMappingsOverlap(mapping, candidate));
    if (overlap) {
      throw new StoneIntegrationConfigurationError(
        "MAPPING_CONFLICT",
        `O Stonecode/terminal já está coberto pelo mapeamento ${overlap.id}.`,
      );
    }
    const now = Timestamp.now();
    const before = currentDocument ? currentDocument.data() : null;
    const document = {
      ...candidate,
      createdAt: before?.createdAt ?? now,
      createdBy: before?.createdBy ?? input.actor,
      updatedAt: now,
      updatedBy: input.actor,
    };
    transaction.set(mappingRef, document);
    transaction.set(mappingRef.collection("events").doc(randomUUID()), {
      type: before ? "updated" : "created",
      before,
      after: document,
      reason: input.reason,
      actor: input.actor,
      createdAt: now,
    });
    return document;
  });
  return serializeFinancialValue(saved);
}
