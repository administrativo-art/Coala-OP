import type { Firestore } from "firebase-admin/firestore";

import type { FormExecution, FormExecutionItem, FormTemplate } from "@/types/forms";

import type { FormItemOption } from "./analytics-config-schema";
import {
  type ExecutionAnswer,
  type ExecutionView,
  type GenerationLookups,
} from "./generator-core";
import { mapTemplateItemsToAnalyticsViews } from "./template-publication";
import { ANALYTICS_COLLECTIONS } from "./types";
import type {
  AnalyticsResultPolarity,
  AnalyticsSeverity,
  AnalyticsTargetScope,
} from "./types";

export const DEFAULT_FORMS_ANALYTICS_TIMEZONE =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE ?? "America/Belem";

function optionValue(option: FormItemOption) {
  return option.value ?? option.label;
}

function structuredOptions(item: FormExecutionItem) {
  return (item.config?.options ?? []).filter(
    (option): option is FormItemOption =>
      typeof option === "object" && option !== null && "id" in option && "label" in option
  );
}

function selectedOptionIds(item: FormExecutionItem, values: string[]) {
  if (values.length === 0) return [];
  const selected = new Set(values.map((value) => String(value)));
  return structuredOptions(item)
    .filter((option) => selected.has(optionValue(option)) || selected.has(option.label))
    .map((option) => option.id);
}

function getAnswerValue(item: FormExecutionItem) {
  if (item.type === "checkbox" && typeof item.checked === "boolean") {
    return item.checked;
  }
  if (item.type === "yes_no" && typeof item.yes_no_value === "boolean") {
    return item.yes_no_value;
  }
  if (
    (item.type === "text" || item.type === "select") &&
    typeof item.text_value === "string" &&
    item.text_value.trim()
  ) {
    return item.text_value.trim();
  }
  if (
    (item.type === "number" || item.type === "temperature") &&
    typeof item.number_value === "number"
  ) {
    return item.number_value;
  }
  if (item.type === "multi_select" && Array.isArray(item.multi_values)) {
    return item.multi_values;
  }
  if (item.type === "date" && typeof item.date_value === "string") {
    return item.date_value;
  }
  if (item.type === "location" && item.location) {
    return item.location;
  }
  return undefined;
}

function locationRef(item: FormExecutionItem) {
  if (!item.location) return undefined;
  const address = item.location.address?.trim();
  return address || `${item.location.lat},${item.location.lng}`;
}

function mapExecutionAnswer(item: FormExecutionItem): ExecutionAnswer {
  const value = getAnswerValue(item);
  const multiValues = Array.isArray(item.multi_values) ? item.multi_values : [];
  const selectedValues =
    item.type === "select" && typeof item.text_value === "string"
      ? [item.text_value]
      : multiValues;

  return {
    value,
    label: Array.isArray(value) ? value.join(", ") : value === undefined ? undefined : String(value),
    selected_option_ids: selectedOptionIds(item, selectedValues),
    is_out_of_range: item.is_out_of_range === true,
    photo_urls: item.photo_urls ?? [],
    file_refs: (item.file_urls ?? []).map((file) => file.url),
    signature_url: item.signature_url,
    location_ref: locationRef(item),
  };
}

export function mapExecutionToAnalyticsView(
  execution: FormExecution
): ExecutionView {
  const completedAt =
    execution.completed_at && !Number.isNaN(new Date(String(execution.completed_at)).getTime())
      ? new Date(String(execution.completed_at))
      : new Date();
  const answers = new Map<string, ExecutionAnswer>();

  (execution.items ?? []).forEach((item) => {
    answers.set(item.template_item_id, mapExecutionAnswer(item));
  });

  const firstCollaboratorId = execution.collaborator_user_ids?.[0];
  const firstCollaboratorName = execution.collaborator_usernames?.[0];

  return {
    id: execution.id,
    workspace_id: execution.workspace_id,
    form_project_id: execution.form_project_id,
    template_id: execution.template_id,
    template_version: execution.template_version,
    completed_at: completedAt,
    unit_id: execution.unit_id,
    unit_name: execution.unit_name,
    assigned_collaborator:
      firstCollaboratorId || firstCollaboratorName
        ? {
            id: firstCollaboratorId ?? firstCollaboratorName ?? "collaborator",
            name: firstCollaboratorName ?? firstCollaboratorId ?? "Colaborador",
          }
        : undefined,
    executor:
      execution.completed_by_user_id || execution.claimed_by_user_id
        ? {
            id:
              execution.completed_by_user_id ??
              execution.claimed_by_user_id ??
              "executor",
            name:
              execution.completed_by_username ??
              execution.claimed_by_username ??
              execution.assigned_username,
          }
        : undefined,
    answers,
  };
}

export function mapTemplateToAnalyticsViews(template: FormTemplate) {
  return mapTemplateItemsToAnalyticsViews(template.sections);
}

export async function loadGenerationLookups(params: {
  db: Firestore;
  workspaceId: string;
}): Promise<GenerationLookups> {
  const [domainsSnap, criteriaSnap, resultsSnap, targetsSnap] = await Promise.all([
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
    params.db
      .collection(ANALYTICS_COLLECTIONS.targets)
      .where("workspace_id", "==", params.workspaceId)
      .get(),
  ]);

  return {
    domains: new Map(
      domainsSnap.docs.map((doc) => [
        doc.id,
        {
          name: String(doc.get("name") ?? ""),
          is_active: doc.get("is_active") === true,
        },
      ])
    ),
    criteria: new Map(
      criteriaSnap.docs.map((doc) => [
        doc.id,
        {
          name: String(doc.get("name") ?? ""),
          domain_id: String(doc.get("domain_id") ?? ""),
          default_severity: doc.get("default_severity") as
            | AnalyticsSeverity
            | undefined,
          is_active: doc.get("is_active") === true,
        },
      ])
    ),
    results: new Map(
      resultsSnap.docs.map((doc) => [
        doc.id,
        {
          name: String(doc.get("name") ?? ""),
          polarity: String(doc.get("polarity") ?? "") as AnalyticsResultPolarity,
          counts_as_evaluation: doc.get("counts_as_evaluation") === true,
          counts_as_occurrence: doc.get("counts_as_occurrence") === true,
          counts_as_non_conformity:
            doc.get("counts_as_non_conformity") === true,
          is_active: doc.get("is_active") === true,
        },
      ])
    ),
    freeTargets: new Map(
      targetsSnap.docs.map((doc) => [
        doc.id,
        {
          name: String(doc.get("name") ?? ""),
          code:
            typeof doc.get("code") === "string"
              ? String(doc.get("code"))
              : undefined,
          type: String(doc.get("type") ?? ""),
          target_scope: String(doc.get("target_scope") ?? "unit") as AnalyticsTargetScope,
          unit_ids: Array.isArray(doc.get("unit_ids"))
            ? (doc.get("unit_ids") as string[])
            : undefined,
        },
      ])
    ),
  };
}
