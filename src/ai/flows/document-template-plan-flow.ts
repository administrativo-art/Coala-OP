import "server-only";

import { z } from "zod";

import { generateStructuredOutput } from "@/ai/google-genai";
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

export async function proposeDocumentTemplatePlan(documentText: string) {
  return generateStructuredOutput({
    input: { documentText },
    inputSchema: Input,
    outputSchema: Output,
    promptTemplate: getActiveSystemPrompt("documents.template-mapping-plan").render({}),
  });
}
