import { goalsAnalysisPrompt } from "@/ai/prompts/commercial/goals-analysis";
import { companyDocumentPrompt } from "@/ai/prompts/documents/company-document";
import { documentTemplatePlanPrompt } from "@/ai/prompts/documents/template-plan";
import { dasExtractionPrompt } from "@/ai/prompts/financial/das-extraction";
import { cardStatementExtractionPrompt } from "@/ai/prompts/financial/card-statement-extraction";
import { payrollGuideExtractionPrompt } from "@/ai/prompts/financial/payroll-guide-extraction";
import { payslipExtractionPrompt } from "@/ai/prompts/financial/payslip-extraction";
import { provisionDocumentExtractionPrompt } from "@/ai/prompts/financial/provision-document-extraction";
import { employeeDocumentPrompt } from "@/ai/prompts/hr/employee-document";
import { consumptionAnalysisPrompt } from "@/ai/prompts/operations/consumption-analysis";
import {
  aiPromptMetadata,
  type AiPromptDefinition,
  type AiPromptMetadata,
  type AiPromptModule,
  type AiPromptStatus,
} from "@/ai/prompts/types";

const definitions = [
  goalsAnalysisPrompt,
  companyDocumentPrompt,
  documentTemplatePlanPrompt,
  cardStatementExtractionPrompt,
  dasExtractionPrompt,
  payrollGuideExtractionPrompt,
  payslipExtractionPrompt,
  provisionDocumentExtractionPrompt,
  employeeDocumentPrompt,
  consumptionAnalysisPrompt,
] as const satisfies readonly AiPromptDefinition<any>[];

const registry = new Map<string, AiPromptDefinition<any>>();
for (const definition of definitions) {
  if (registry.has(definition.id)) throw new Error(`Prompt duplicado no registro: ${definition.id}`);
  registry.set(definition.id, definition);
}

export type SystemPromptId = (typeof definitions)[number]["id"];

export function getSystemPrompt<Context = Record<string, never>>(id: SystemPromptId): AiPromptDefinition<Context> {
  const definition = registry.get(id);
  if (!definition) throw new Error(`Prompt não registrado: ${id}`);
  return definition as AiPromptDefinition<Context>;
}

export function getActiveSystemPrompt<Context = Record<string, never>>(id: SystemPromptId): AiPromptDefinition<Context> {
  const definition = getSystemPrompt<Context>(id);
  if (definition.status !== "active") {
    throw new Error(`Prompt não está ativo: ${id} (${definition.status})`);
  }
  return definition;
}

export function renderSystemPrompt<Context>(id: SystemPromptId, context: Context) {
  return getActiveSystemPrompt<Context>(id).render(context);
}

export function listSystemPrompts(filters: { module?: AiPromptModule; status?: AiPromptStatus } = {}): AiPromptMetadata[] {
  return definitions
    .filter((definition) => !filters.module || definition.module === filters.module)
    .filter((definition) => !filters.status || definition.status === filters.status)
    .map(aiPromptMetadata)
    .sort((left, right) => left.id.localeCompare(right.id));
}
