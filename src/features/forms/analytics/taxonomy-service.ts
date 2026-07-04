import {
  FieldValue,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

import {
  createAnalyticsCriterionSchema,
  createAnalyticsDomainSchema,
  createAnalyticsResultSchema,
  createAnalyticsTargetSchema,
  updateAnalyticsCriterionSchema,
  updateAnalyticsDomainSchema,
  updateAnalyticsResultSchema,
  updateAnalyticsTargetSchema,
  type CreateAnalyticsCriterionInput,
  type CreateAnalyticsDomainInput,
  type CreateAnalyticsResultInput,
  type CreateAnalyticsTargetInput,
  type UpdateAnalyticsCriterionInput,
  type UpdateAnalyticsDomainInput,
  type UpdateAnalyticsResultInput,
  type UpdateAnalyticsTargetInput,
} from "./schemas";
import { uniqueSlug } from "./slug";
import { ANALYTICS_COLLECTIONS } from "./types";

export type TaxonomyErrorCode =
  | "not_found"
  | "slug_conflict"
  | "in_use"
  | "invalid_reference"
  | "immutable_field"
  | "not_editable";

export class TaxonomyError extends Error {
  constructor(
    message: string,
    public readonly code: TaxonomyErrorCode
  ) {
    super(message);
    this.name = "TaxonomyError";
  }
}

interface TaxonomyReadCtx {
  db: Firestore;
  workspaceId: string;
}

interface TaxonomyWriteCtx extends TaxonomyReadCtx {
  userId: string;
}

type ListOptions = {
  isActive?: boolean;
};

type CriteriaListOptions = ListOptions & {
  domainId?: string | null;
};

type TargetsListOptions = ListOptions & {
  type?: string | null;
};

const now = () => FieldValue.serverTimestamp();

function serializeAnalyticsValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeAnalyticsValue);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeAnalyticsValue(entry),
      ])
    );
  }
  return value;
}

function normalizeDoc<T>(doc: QueryDocumentSnapshot) {
  return {
    id: doc.id,
    ...((serializeAnalyticsValue(doc.data()) as Record<string, unknown>) ?? {}),
  } as T;
}

function sortByOrderAndName<T extends { order?: number; name?: string }>(
  items: T[]
) {
  return [...items].sort((left, right) => {
    const orderDiff = (left.order ?? 0) - (right.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return String(left.name ?? "").localeCompare(String(right.name ?? ""));
  });
}

async function listOwnedDocs<T>(
  ctx: TaxonomyReadCtx,
  collectionName: string
) {
  const snap = await ctx.db
    .collection(collectionName)
    .where("workspace_id", "==", ctx.workspaceId)
    .get();
  return snap.docs.map((doc) => normalizeDoc<T>(doc));
}

async function existingSlugs(
  tx: Transaction,
  ctx: TaxonomyReadCtx,
  collectionName: string,
  extraFilter?: { field: string; value: string }
) {
  let query: Query = ctx.db
    .collection(collectionName)
    .where("workspace_id", "==", ctx.workspaceId);
  if (extraFilter) {
    query = query.where(extraFilter.field, "==", extraFilter.value);
  }

  const snap = await tx.get(query.select("slug"));
  return new Set(snap.docs.map((doc) => String(doc.get("slug"))));
}

async function getOwnedDoc(
  tx: Transaction,
  ctx: TaxonomyReadCtx,
  collectionName: string,
  id: string
) {
  const ref = ctx.db.collection(collectionName).doc(id);
  const snap = await tx.get(ref);
  if (!snap.exists || snap.get("workspace_id") !== ctx.workspaceId) {
    throw new TaxonomyError(`Registro não encontrado: ${id}`, "not_found");
  }
  return { ref, snap };
}

async function assertActiveReference(
  tx: Transaction,
  ctx: TaxonomyReadCtx,
  collectionName: string,
  id: string,
  label: string
) {
  const snap = await tx.get(ctx.db.collection(collectionName).doc(id));
  if (
    !snap.exists ||
    snap.get("workspace_id") !== ctx.workspaceId ||
    snap.get("is_active") !== true
  ) {
    throw new TaxonomyError(
      `${label} inexistente ou inativo: ${id}`,
      "invalid_reference"
    );
  }
}

async function isUsed(
  ctx: TaxonomyReadCtx,
  field: "domain_id" | "criterion_id" | "result_id" | "target_id",
  id: string
) {
  const snap = await ctx.db
    .collection(ANALYTICS_COLLECTIONS.occurrences)
    .where("workspace_id", "==", ctx.workspaceId)
    .where(field, "==", id)
    .limit(1)
    .get();

  return !snap.empty;
}

export async function markTaxonomyUsed(
  ctx: TaxonomyWriteCtx,
  collectionName: string,
  id: string
) {
  await ctx.db.collection(collectionName).doc(id).set(
    {
      is_deletable: false,
      updated_at: now(),
      updated_by: ctx.userId,
    },
    { merge: true }
  );
}

export async function listAnalyticsDomains(
  ctx: TaxonomyReadCtx,
  options: ListOptions = {}
) {
  const domains = await listOwnedDocs<Record<string, unknown>>(
    ctx,
    ANALYTICS_COLLECTIONS.domains
  );
  return sortByOrderAndName(
    domains.filter((domain) =>
      typeof options.isActive === "boolean"
        ? domain.is_active === options.isActive
        : true
    )
  );
}

export async function listAnalyticsCriteria(
  ctx: TaxonomyReadCtx,
  options: CriteriaListOptions = {}
) {
  const criteria = await listOwnedDocs<Record<string, unknown>>(
    ctx,
    ANALYTICS_COLLECTIONS.criteria
  );
  return sortByOrderAndName(
    criteria.filter((criterion) => {
      if (
        typeof options.isActive === "boolean" &&
        criterion.is_active !== options.isActive
      ) {
        return false;
      }
      if (options.domainId && criterion.domain_id !== options.domainId) {
        return false;
      }
      return true;
    })
  );
}

export async function listAnalyticsResults(
  ctx: TaxonomyReadCtx,
  options: ListOptions = {}
) {
  const results = await listOwnedDocs<Record<string, unknown>>(
    ctx,
    ANALYTICS_COLLECTIONS.results
  );
  return sortByOrderAndName(
    results.filter((result) =>
      typeof options.isActive === "boolean"
        ? result.is_active === options.isActive
        : true
    )
  );
}

export async function listAnalyticsTargets(
  ctx: TaxonomyReadCtx,
  options: TargetsListOptions = {}
) {
  const targets = await listOwnedDocs<Record<string, unknown>>(
    ctx,
    ANALYTICS_COLLECTIONS.targets
  );
  return sortByOrderAndName(
    targets.filter((target) => {
      if (
        typeof options.isActive === "boolean" &&
        target.is_active !== options.isActive
      ) {
        return false;
      }
      if (options.type && target.type !== options.type) {
        return false;
      }
      return true;
    })
  );
}

export async function createAnalyticsDomain(
  ctx: TaxonomyWriteCtx,
  raw: unknown
) {
  const input: CreateAnalyticsDomainInput =
    createAnalyticsDomainSchema.parse(raw);

  return ctx.db.runTransaction(async (tx) => {
    const slugs = await existingSlugs(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.domains
    );
    const slug = uniqueSlug(input.name, slugs);
    const ref = ctx.db.collection(ANALYTICS_COLLECTIONS.domains).doc();

    tx.create(ref, {
      ...input,
      workspace_id: ctx.workspaceId,
      slug,
      source: "user_created",
      is_editable: true,
      is_deletable: true,
      created_at: now(),
      updated_at: now(),
      created_by: ctx.userId,
    });

    return ref.id;
  });
}

export async function updateAnalyticsDomain(
  ctx: TaxonomyWriteCtx,
  id: string,
  raw: unknown
) {
  const patch: UpdateAnalyticsDomainInput =
    updateAnalyticsDomainSchema.parse(raw);

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.domains,
      id
    );
    if (snap.get("is_editable") === false) {
      throw new TaxonomyError("Domínio não é editável.", "not_editable");
    }
    tx.update(ref, { ...patch, updated_at: now(), updated_by: ctx.userId });
  });
}

export async function deactivateAnalyticsDomain(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  await ctx.db.runTransaction(async (tx) => {
    const { ref } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.domains,
      id
    );
    tx.update(ref, {
      is_active: false,
      updated_at: now(),
      updated_by: ctx.userId,
    });
  });
}

export async function deleteAnalyticsDomainIfUnused(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  if (await isUsed(ctx, "domain_id", id)) {
    throw new TaxonomyError(
      "Domínio já usado em registros derivados; desative em vez de apagar.",
      "in_use"
    );
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.domains,
      id
    );
    if (snap.get("is_deletable") === false) {
      throw new TaxonomyError("Domínio marcado como não removível.", "in_use");
    }
    const children = await tx.get(
      ctx.db
        .collection(ANALYTICS_COLLECTIONS.criteria)
        .where("workspace_id", "==", ctx.workspaceId)
        .where("domain_id", "==", id)
        .limit(1)
    );
    if (!children.empty) {
      throw new TaxonomyError(
        "Domínio possui quesitos; desative o domínio.",
        "in_use"
      );
    }
    tx.delete(ref);
  });
}

export async function createAnalyticsCriterion(
  ctx: TaxonomyWriteCtx,
  raw: unknown
) {
  const input: CreateAnalyticsCriterionInput =
    createAnalyticsCriterionSchema.parse(raw);

  return ctx.db.runTransaction(async (tx) => {
    await assertActiveReference(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.domains,
      input.domain_id,
      "Domínio"
    );
    if (input.default_result_positive_id) {
      await assertActiveReference(
        tx,
        ctx,
        ANALYTICS_COLLECTIONS.results,
        input.default_result_positive_id,
        "Resultado positivo padrão"
      );
    }
    if (input.default_result_negative_id) {
      await assertActiveReference(
        tx,
        ctx,
        ANALYTICS_COLLECTIONS.results,
        input.default_result_negative_id,
        "Resultado negativo padrão"
      );
    }

    const slugs = await existingSlugs(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.criteria,
      { field: "domain_id", value: input.domain_id }
    );
    const slug = uniqueSlug(input.name, slugs);
    const ref = ctx.db.collection(ANALYTICS_COLLECTIONS.criteria).doc();

    tx.create(ref, {
      ...input,
      workspace_id: ctx.workspaceId,
      slug,
      source: "user_created",
      is_editable: true,
      is_deletable: true,
      created_at: now(),
      updated_at: now(),
      created_by: ctx.userId,
    });

    return ref.id;
  });
}

export async function updateAnalyticsCriterion(
  ctx: TaxonomyWriteCtx,
  id: string,
  raw: unknown
) {
  const patch: UpdateAnalyticsCriterionInput =
    updateAnalyticsCriterionSchema.parse(raw);
  if (raw && typeof raw === "object" && "domain_id" in raw) {
    throw new TaxonomyError(
      "domain_id é imutável; desative e recrie no domínio de destino.",
      "immutable_field"
    );
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.criteria,
      id
    );
    if (snap.get("is_editable") === false) {
      throw new TaxonomyError("Quesito não é editável.", "not_editable");
    }
    if (patch.default_result_positive_id) {
      await assertActiveReference(
        tx,
        ctx,
        ANALYTICS_COLLECTIONS.results,
        patch.default_result_positive_id,
        "Resultado positivo padrão"
      );
    }
    if (patch.default_result_negative_id) {
      await assertActiveReference(
        tx,
        ctx,
        ANALYTICS_COLLECTIONS.results,
        patch.default_result_negative_id,
        "Resultado negativo padrão"
      );
    }
    tx.update(ref, { ...patch, updated_at: now(), updated_by: ctx.userId });
  });
}

export async function deactivateAnalyticsCriterion(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  await ctx.db.runTransaction(async (tx) => {
    const { ref } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.criteria,
      id
    );
    tx.update(ref, {
      is_active: false,
      updated_at: now(),
      updated_by: ctx.userId,
    });
  });
}

export async function deleteAnalyticsCriterionIfUnused(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  if (await isUsed(ctx, "criterion_id", id)) {
    throw new TaxonomyError(
      "Quesito já usado em registros derivados; desative em vez de apagar.",
      "in_use"
    );
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.criteria,
      id
    );
    if (snap.get("is_deletable") === false) {
      throw new TaxonomyError("Quesito marcado como não removível.", "in_use");
    }
    tx.delete(ref);
  });
}

export async function createAnalyticsResult(
  ctx: TaxonomyWriteCtx,
  raw: unknown
) {
  const input: CreateAnalyticsResultInput =
    createAnalyticsResultSchema.parse(raw);

  return ctx.db.runTransaction(async (tx) => {
    const slugs = await existingSlugs(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.results
    );
    const slug = uniqueSlug(input.name, slugs);
    const ref = ctx.db.collection(ANALYTICS_COLLECTIONS.results).doc();

    tx.create(ref, {
      ...input,
      workspace_id: ctx.workspaceId,
      slug,
      source: "user_created",
      is_editable: true,
      is_deletable: true,
      created_at: now(),
      updated_at: now(),
      created_by: ctx.userId,
    });

    return ref.id;
  });
}

export async function updateAnalyticsResult(
  ctx: TaxonomyWriteCtx,
  id: string,
  raw: unknown
) {
  const patch: UpdateAnalyticsResultInput =
    updateAnalyticsResultSchema.parse(raw);
  const forbidden = [
    "polarity",
    "counts_as_evaluation",
    "counts_as_occurrence",
    "counts_as_non_conformity",
  ];

  for (const field of forbidden) {
    if (raw && typeof raw === "object" && field in raw) {
      throw new TaxonomyError(
        `${field} é imutável; desative este resultado e crie outro.`,
        "immutable_field"
      );
    }
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.results,
      id
    );
    if (snap.get("is_editable") === false) {
      throw new TaxonomyError("Resultado não é editável.", "not_editable");
    }
    tx.update(ref, { ...patch, updated_at: now(), updated_by: ctx.userId });
  });
}

export async function deactivateAnalyticsResult(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  await ctx.db.runTransaction(async (tx) => {
    const { ref } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.results,
      id
    );
    tx.update(ref, {
      is_active: false,
      updated_at: now(),
      updated_by: ctx.userId,
    });
  });
}

export async function deleteAnalyticsResultIfUnused(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  if (await isUsed(ctx, "result_id", id)) {
    throw new TaxonomyError(
      "Resultado já usado em registros derivados; desative em vez de apagar.",
      "in_use"
    );
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.results,
      id
    );
    if (snap.get("is_deletable") === false) {
      throw new TaxonomyError(
        "Resultado marcado como não removível.",
        "in_use"
      );
    }

    for (const field of [
      "default_result_positive_id",
      "default_result_negative_id",
    ]) {
      const refs = await tx.get(
        ctx.db
          .collection(ANALYTICS_COLLECTIONS.criteria)
          .where("workspace_id", "==", ctx.workspaceId)
          .where(field, "==", id)
          .limit(1)
      );
      if (!refs.empty) {
        throw new TaxonomyError(
          "Resultado é padrão de um ou mais quesitos.",
          "in_use"
        );
      }
    }

    tx.delete(ref);
  });
}

export async function createAnalyticsTarget(
  ctx: TaxonomyWriteCtx,
  raw: unknown
) {
  const input: CreateAnalyticsTargetInput =
    createAnalyticsTargetSchema.parse(raw);

  return ctx.db.runTransaction(async (tx) => {
    if (input.parent_id) {
      await assertActiveReference(
        tx,
        ctx,
        ANALYTICS_COLLECTIONS.targets,
        input.parent_id,
        "Alvo pai"
      );
    }
    const ref = ctx.db.collection(ANALYTICS_COLLECTIONS.targets).doc();

    tx.create(ref, {
      ...input,
      workspace_id: ctx.workspaceId,
      source: "user_created",
      is_editable: true,
      is_deletable: true,
      created_at: now(),
      updated_at: now(),
      created_by: ctx.userId,
    });

    return ref.id;
  });
}

export async function updateAnalyticsTarget(
  ctx: TaxonomyWriteCtx,
  id: string,
  raw: unknown
) {
  const patch: UpdateAnalyticsTargetInput =
    updateAnalyticsTargetSchema.parse(raw);
  if (raw && typeof raw === "object" && "type" in raw) {
    throw new TaxonomyError(
      "type do alvo é imutável porque participa da identidade.",
      "immutable_field"
    );
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.targets,
      id
    );
    if (snap.get("is_editable") === false) {
      throw new TaxonomyError("Alvo não é editável.", "not_editable");
    }

    if (patch.parent_id) {
      await assertActiveReference(
        tx,
        ctx,
        ANALYTICS_COLLECTIONS.targets,
        patch.parent_id,
        "Alvo pai"
      );
    }

    const merged = { ...snap.data(), ...patch } as {
      type: string;
      target_scope: string;
      unit_ids?: string[];
    };
    const isLocal = merged.type === "location" || merged.type === "free_target";
    const hasUnits = (merged.unit_ids?.length ?? 0) > 0;

    if (isLocal && merged.target_scope !== "workspace" && !hasUnits) {
      throw new TaxonomyError(
        'Alvo local exige unidade ou target_scope="workspace".',
        "invalid_reference"
      );
    }
    if (merged.target_scope === "unit" && (merged.unit_ids?.length ?? 0) !== 1) {
      throw new TaxonomyError(
        'Escopo "unit" exige exatamente uma unidade.',
        "invalid_reference"
      );
    }
    if (merged.target_scope === "workspace" && hasUnits) {
      throw new TaxonomyError(
        "Alvo global não deve listar unidades.",
        "invalid_reference"
      );
    }

    tx.update(ref, { ...patch, updated_at: now(), updated_by: ctx.userId });
  });
}

export async function deactivateAnalyticsTarget(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  await ctx.db.runTransaction(async (tx) => {
    const { ref } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.targets,
      id
    );
    tx.update(ref, {
      is_active: false,
      updated_at: now(),
      updated_by: ctx.userId,
    });
  });
}

export async function deleteAnalyticsTargetIfUnused(
  ctx: TaxonomyWriteCtx,
  id: string
) {
  if (await isUsed(ctx, "target_id", id)) {
    throw new TaxonomyError(
      "Alvo já usado em registros derivados; desative em vez de apagar.",
      "in_use"
    );
  }

  await ctx.db.runTransaction(async (tx) => {
    const { ref, snap } = await getOwnedDoc(
      tx,
      ctx,
      ANALYTICS_COLLECTIONS.targets,
      id
    );
    if (snap.get("is_deletable") === false) {
      throw new TaxonomyError("Alvo marcado como não removível.", "in_use");
    }

    const children = await tx.get(
      ctx.db
        .collection(ANALYTICS_COLLECTIONS.targets)
        .where("workspace_id", "==", ctx.workspaceId)
        .where("parent_id", "==", id)
        .limit(1)
    );
    if (!children.empty) {
      throw new TaxonomyError("Alvo possui filhos; desative-o.", "in_use");
    }

    tx.delete(ref);
  });
}
