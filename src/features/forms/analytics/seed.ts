import {
  FieldValue,
  type Firestore,
  type Timestamp,
} from "firebase-admin/firestore";

import { ANALYTICS_COLLECTIONS } from "./types";
import {
  SEED_ANALYTICS_CRITERIA,
  SEED_ANALYTICS_DOMAINS,
  SEED_ANALYTICS_RESULTS,
} from "./seed-data";

export interface SeedAnalyticsTaxonomyOptions {
  workspaceId: string;
  createdBy: string;
}

export interface SeedAnalyticsTaxonomyReport {
  created: { domains: number; results: number; criteria: number };
  skipped: { domains: number; results: number; criteria: number };
}

const GOVERNANCE = {
  source: "system_seed" as const,
  is_editable: true,
  is_deletable: true,
  is_active: true,
};

const BATCH_LIMIT = 400;

type SeedDoc = {
  id: string;
  data: Record<string, unknown>;
};

async function createMissing(
  db: Firestore,
  collectionName: string,
  docs: SeedDoc[]
) {
  const refs = docs.map((doc) => db.collection(collectionName).doc(doc.id));
  const existing = new Set<string>();

  for (let index = 0; index < refs.length; index += BATCH_LIMIT) {
    const snaps = await db.getAll(...refs.slice(index, index + BATCH_LIMIT));
    snaps.forEach((snap) => {
      if (snap.exists) existing.add(snap.id);
    });
  }

  const toCreate = docs.filter((doc) => !existing.has(doc.id));
  for (let index = 0; index < toCreate.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    toCreate.slice(index, index + BATCH_LIMIT).forEach((doc) => {
      batch.create(db.collection(collectionName).doc(doc.id), doc.data);
    });
    await batch.commit();
  }

  return { created: toCreate.length, skipped: existing.size };
}

export async function seedAnalyticsTaxonomy(
  db: Firestore,
  opts: SeedAnalyticsTaxonomyOptions
): Promise<SeedAnalyticsTaxonomyReport> {
  const now = FieldValue.serverTimestamp() as unknown as Timestamp;
  const common = {
    workspace_id: opts.workspaceId,
    ...GOVERNANCE,
    created_at: now,
    updated_at: now,
    created_by: opts.createdBy,
  };
  const workspaceSeedId = (seedId: string) => `${opts.workspaceId}__${seedId}`;

  const domainDocs: SeedDoc[] = SEED_ANALYTICS_DOMAINS.map((domain) => ({
    id: workspaceSeedId(domain.id),
    data: {
      ...common,
      name: domain.name,
      slug: domain.slug,
      color: domain.color,
      icon: domain.icon,
      order: domain.order,
    },
  }));

  const resultDocs: SeedDoc[] = SEED_ANALYTICS_RESULTS.map((result) => ({
    id: workspaceSeedId(result.id),
    data: {
      ...common,
      name: result.name,
      slug: result.slug,
      polarity: result.polarity,
      ...(result.severity ? { severity: result.severity } : {}),
      counts_as_evaluation: result.counts_as_evaluation,
      counts_as_occurrence: result.counts_as_occurrence,
      counts_as_non_conformity: result.counts_as_non_conformity,
      ...(result.is_closing_result ? { is_closing_result: true } : {}),
      color: result.color,
      order: result.order,
    },
  }));

  const criterionDocs: SeedDoc[] = SEED_ANALYTICS_CRITERIA.map((criterion) => ({
    id: workspaceSeedId(criterion.id),
    data: {
      ...common,
      domain_id: workspaceSeedId(criterion.domain_id),
      name: criterion.name,
      slug: criterion.slug,
      ...(criterion.target_type ? { target_type: criterion.target_type } : {}),
      ...(criterion.default_severity
        ? { default_severity: criterion.default_severity }
        : {}),
      default_result_positive_id: workspaceSeedId(
        criterion.default_result_positive_id
      ),
      default_result_negative_id: workspaceSeedId(
        criterion.default_result_negative_id
      ),
      order: criterion.order,
    },
  }));

  const results = await createMissing(
    db,
    ANALYTICS_COLLECTIONS.results,
    resultDocs
  );
  const domains = await createMissing(
    db,
    ANALYTICS_COLLECTIONS.domains,
    domainDocs
  );
  const criteria = await createMissing(
    db,
    ANALYTICS_COLLECTIONS.criteria,
    criterionDocs
  );

  return {
    created: {
      domains: domains.created,
      results: results.created,
      criteria: criteria.created,
    },
    skipped: {
      domains: domains.skipped,
      results: results.skipped,
      criteria: criteria.skipped,
    },
  };
}
