import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

export const RETENTION_POLICIES_COLLECTION = "form_analytics_retention_policies";

const CACHE_TTL_MS = 5 * 60 * 1000;

export const retentionSubjectTypes = [
  "collaborator",
  "customer",
  "third_party",
  "any",
] as const;
export type RetentionSubjectType = (typeof retentionSubjectTypes)[number];

export const createRetentionPolicySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    subject_type: z.enum(retentionSubjectTypes).default("any"),
    retention_days: z.number().int().min(1).max(3650),
    keep_original_in_vault: z.boolean().default(false),
    is_default: z.boolean().default(false),
    is_active: z.boolean().default(true),
  })
  .strict();

export const updateRetentionPolicySchema = createRetentionPolicySchema
  .partial()
  .strict();

export type CreateRetentionPolicyInput = z.infer<
  typeof createRetentionPolicySchema
>;

export interface RetentionPolicy extends CreateRetentionPolicyInput {
  id: string;
  workspace_id: string;
}

export class RetentionPolicyError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid"
  ) {
    super(message);
    this.name = "RetentionPolicyError";
  }
}

interface Ctx {
  db: Firestore;
  workspaceId: string;
  userId: string;
}

const now = () => FieldValue.serverTimestamp();

const cache = new Map<
  string,
  { value: RetentionPolicy[]; expires_at: number }
>();

function invalidate(workspaceId: string) {
  cache.delete(workspaceId);
}

export async function listRetentionPolicies(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  opts: { onlyActive?: boolean } = {}
): Promise<RetentionPolicy[]> {
  const cached = cache.get(ctx.workspaceId);
  let policies: RetentionPolicy[];
  if (cached && cached.expires_at > Date.now()) {
    policies = cached.value;
  } else {
    const snap = await ctx.db
      .collection(RETENTION_POLICIES_COLLECTION)
      .where("workspace_id", "==", ctx.workspaceId)
      .get();
    policies = snap.docs.map((doc) => ({
      id: doc.id,
      workspace_id: ctx.workspaceId,
      name: String(doc.get("name") ?? ""),
      subject_type: (doc.get("subject_type") as RetentionSubjectType) ?? "any",
      retention_days: Number(doc.get("retention_days") ?? 0),
      keep_original_in_vault: doc.get("keep_original_in_vault") === true,
      is_default: doc.get("is_default") === true,
      is_active: doc.get("is_active") !== false,
    }));
    cache.set(ctx.workspaceId, {
      value: policies,
      expires_at: Date.now() + CACHE_TTL_MS,
    });
  }

  return opts.onlyActive ? policies.filter((p) => p.is_active) : policies;
}

// Resolve a política aplicável a um sujeito de dado pessoal: prioriza a
// política específica do subject_type; senão a marcada como default; senão a
// primeira ativa. Retorna null se não houver política configurada (o chamador
// cai no fallback por env).
export async function resolveRetentionForSubject(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  subjectType: RetentionSubjectType | undefined
): Promise<{ id: string; days: number; keep_original_in_vault: boolean } | null> {
  const active = await listRetentionPolicies(ctx, { onlyActive: true });
  if (active.length === 0) return null;

  const bySubject =
    subjectType && subjectType !== "any"
      ? active.find((p) => p.subject_type === subjectType)
      : undefined;
  const chosen =
    bySubject ??
    active.find((p) => p.is_default) ??
    active.find((p) => p.subject_type === "any") ??
    active[0];

  return {
    id: chosen.id,
    days: chosen.retention_days,
    keep_original_in_vault: chosen.keep_original_in_vault,
  };
}

export async function createRetentionPolicy(ctx: Ctx, raw: unknown) {
  const input = createRetentionPolicySchema.parse(raw);
  const ref = ctx.db.collection(RETENTION_POLICIES_COLLECTION).doc();
  await ctx.db.runTransaction(async (tx) => {
    if (input.is_default) await clearDefault(ctx, tx);
    tx.create(ref, {
      ...input,
      workspace_id: ctx.workspaceId,
      created_at: now(),
      updated_at: now(),
      created_by: ctx.userId,
    });
  });
  invalidate(ctx.workspaceId);
  return ref.id;
}

export async function updateRetentionPolicy(ctx: Ctx, id: string, raw: unknown) {
  const patch = updateRetentionPolicySchema.parse(raw);
  const ref = ctx.db.collection(RETENTION_POLICIES_COLLECTION).doc(id);
  await ctx.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("workspace_id") !== ctx.workspaceId) {
      throw new RetentionPolicyError("Política não encontrada.", "not_found");
    }
    if (patch.is_default) await clearDefault(ctx, tx, id);
    tx.update(ref, { ...patch, updated_at: now(), updated_by: ctx.userId });
  });
  invalidate(ctx.workspaceId);
}

async function clearDefault(
  ctx: Ctx,
  tx: FirebaseFirestore.Transaction,
  exceptId?: string
) {
  const snap = await tx.get(
    ctx.db
      .collection(RETENTION_POLICIES_COLLECTION)
      .where("workspace_id", "==", ctx.workspaceId)
      .where("is_default", "==", true)
  );
  for (const doc of snap.docs) {
    if (doc.id !== exceptId) tx.update(doc.ref, { is_default: false });
  }
}

export function retentionPolicyErrorResponse(error: unknown) {
  if (error instanceof RetentionPolicyError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.code === "not_found" ? 404 : 400 }
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "Payload inválido.", issues: error.issues },
      { status: 400 }
    );
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Falha." },
    { status: 400 }
  );
}
