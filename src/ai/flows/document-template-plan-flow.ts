import "server-only";

import { z } from "zod";

import { ai, DEFAULT_MODEL } from "@/ai/genkit";
import { getActiveSystemPrompt } from "@/ai/prompts/registry";

const Input = z.object({
  documentText: z.string().max(60_000),
});

const Mapping = z.object({
  exactText: z.string().min(1).max(500),
  expectedOccurrences: z.number().int().positive(),
  variableKey: z.string().min(1).max(160),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500),
});

const Output = z.object({
  mappings: z.array(Mapping).max(120),
  formSchemaProposal: z.record(z.unknown()).nullable(),
  documentClass: z.string().max(80),
  retentionAnchorType: z.string().max(80),
  signatureScope: z.enum(["bundle", "standalone", "none"]),
});

const prompt = ai.definePrompt({
  name: "documentTemplateMappingPlan",
  model: DEFAULT_MODEL,
  input: { schema: Input },
  output: { schema: Output },
  prompt: getActiveSystemPrompt("documents.template-mapping-plan").render({}),
});

export async function proposeDocumentTemplatePlan(documentText: string) {
  const { output } = await prompt({ documentText });
  if (!output) throw new Error("A IA não devolveu um plano estruturado.");
  return output;
}
