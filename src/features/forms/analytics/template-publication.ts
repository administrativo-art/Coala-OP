import type { Firestore } from "firebase-admin/firestore";

import type {
  FormConditionalRule,
  FormTemplateItem,
  FormTemplateSection,
} from "@/types/forms";

import {
  analyticsItemViewSchema,
  formItemOptionSchema,
  type AnalyticsItemView,
  type FormItemOption,
} from "./analytics-config-schema";
import {
  validateTemplateAnalytics,
  type TaxonomyLookups,
  type ValidationReport,
} from "./publication-validator";
import { ANALYTICS_COLLECTIONS } from "./types";
import type { AnalyticsResultPolarity } from "./types";

export function flattenTemplateItems(
  sections: readonly FormTemplateSection[]
): FormTemplateItem[] {
  const items: FormTemplateItem[] = [];

  function visit(templateItems: readonly FormTemplateItem[]) {
    templateItems.forEach((item) => {
      items.push(item);
      item.conditional_branches?.forEach((branch) => visit(branch.items));
    });
  }

  sections.forEach((section) => visit(section.items));
  return items;
}

export function hasEnabledAnalyticsConfig(
  sections: readonly FormTemplateSection[]
) {
  return flattenTemplateItems(sections).some(
    (item) => item.analytics_config?.enabled === true
  );
}

function mapShowIf(rule?: FormConditionalRule) {
  if (!rule) return undefined;
  if (rule.operator !== "equals" && rule.operator !== "not_equals") {
    return undefined;
  }
  if (rule.value === undefined) return undefined;

  return {
    item_id: rule.item_id,
    operator: rule.operator,
    value: rule.value,
  };
}

function mapStructuredOptions(options: unknown): FormItemOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const structuredOptions = options
    .map((option) => formItemOptionSchema.safeParse(option))
    .filter((result) => result.success)
    .map((result) => result.data);

  return structuredOptions.length > 0 ? structuredOptions : undefined;
}

export function mapTemplateItemsToAnalyticsViews(
  sections: readonly FormTemplateSection[]
) {
  return flattenTemplateItems(sections).map((item) => {
    const view = {
      id: item.id,
      type: item.type,
      title: item.title,
      options: mapStructuredOptions(item.config?.options),
      show_if: mapShowIf(item.show_if),
      analytics_config: item.analytics_config,
    };

    return analyticsItemViewSchema.parse(view);
  }) satisfies AnalyticsItemView[];
}

export async function loadAnalyticsTaxonomyLookups(params: {
  db: Firestore;
  workspaceId: string;
}): Promise<TaxonomyLookups> {
  const [domainsSnap, criteriaSnap, resultsSnap] = await Promise.all([
    params.db
      .collection(ANALYTICS_COLLECTIONS.domains)
      .where("workspace_id", "==", params.workspaceId)
      .get(),
    params.db
      .collection(ANALYTICS_COLLECTIONS.criteria)
      .where("workspace_id", "==", params.workspaceId)
      .get(),
    params.db
      .collection(ANALYTICS_COLLECTIONS.results)
      .where("workspace_id", "==", params.workspaceId)
      .get(),
  ]);

  return {
    domains: new Map(
      domainsSnap.docs.map((doc) => [
        doc.id,
        { is_active: doc.get("is_active") === true },
      ])
    ),
    criteria: new Map(
      criteriaSnap.docs.map((doc) => [
        doc.id,
        {
          domain_id: String(doc.get("domain_id") ?? ""),
          is_active: doc.get("is_active") === true,
        },
      ])
    ),
    results: new Map(
      resultsSnap.docs.map((doc) => [
        doc.id,
        {
          polarity: String(doc.get("polarity") ?? "") as AnalyticsResultPolarity,
          counts_as_non_conformity:
            doc.get("counts_as_non_conformity") === true,
          is_active: doc.get("is_active") === true,
        },
      ])
    ),
  };
}

export async function validateTemplateAnalyticsPublication(params: {
  db: Firestore;
  workspaceId: string;
  sections: readonly FormTemplateSection[];
}): Promise<ValidationReport> {
  if (!hasEnabledAnalyticsConfig(params.sections)) {
    return { ok: true, issues: [] };
  }

  const taxonomy = await loadAnalyticsTaxonomyLookups({
    db: params.db,
    workspaceId: params.workspaceId,
  });
  return validateTemplateAnalytics(
    mapTemplateItemsToAnalyticsViews(params.sections),
    taxonomy
  );
}
