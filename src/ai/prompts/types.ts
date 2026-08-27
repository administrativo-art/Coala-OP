export const AI_PROMPT_MODULES = [
  "commercial",
  "documents",
  "financial",
  "hr",
  "operations",
] as const;

export type AiPromptModule = (typeof AI_PROMPT_MODULES)[number];
export type AiPromptStatus = "active" | "draft" | "deprecated";
export type AiPromptRisk = "low" | "medium" | "high";
export type AiPromptOutputMode = "text" | "structured";

export type AiPromptDefinition<Context = Record<string, never>> = {
  id: string;
  module: AiPromptModule;
  name: string;
  description: string;
  version: string;
  schemaVersion: string | null;
  status: AiPromptStatus;
  risk: AiPromptRisk;
  outputMode: AiPromptOutputMode;
  owner: string;
  tags: readonly string[];
  /** Limite entre interpretação da IA e decisão determinística do sistema. */
  rulesBoundary: string;
  render: (context: Context) => string;
};

export type AiPromptMetadata = Omit<AiPromptDefinition<unknown>, "render">;

export function defineAiPrompt<Context>(definition: AiPromptDefinition<Context>) {
  return Object.freeze({
    ...definition,
    tags: Object.freeze([...definition.tags]),
  });
}

export function aiPromptMetadata(definition: AiPromptDefinition<any>): AiPromptMetadata {
  const { render: _render, ...metadata } = definition;
  return metadata;
}
