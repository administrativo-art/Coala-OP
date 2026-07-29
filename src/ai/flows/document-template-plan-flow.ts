import "server-only";

import { z } from "zod";

import { ai, DEFAULT_MODEL } from "@/ai/genkit";
import { DOCUMENT_VARIABLES } from "@/features/hr/integration/document-variables";

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

const variableCatalog = DOCUMENT_VARIABLES
  .map((entry) => `${entry.key}: ${entry.label}`)
  .join("\n")
  .slice(0, 30_000);

const prompt = ai.definePrompt({
  name: "documentTemplateMappingPlan",
  model: DEFAULT_MODEL,
  input: { schema: Input },
  output: { schema: Output },
  prompt: `Você prepara um plano revisável para transformar uma matriz DOCX em modelo do Coala One.
Você NUNCA altera o arquivo e não inventa trechos. Cada exactText deve existir literalmente no texto recebido.
Sugira somente substituições de dados variáveis, nunca redação jurídica.
Informe a contagem exata de ocorrências esperada, confiança e justificativa.
Quando necessário, proponha um schema de formulário com passos, campos, partes, condições e repetições.

CATÁLOGO:
${variableCatalog}

TEXTO DA MATRIZ:
{{documentText}}`,
});

export async function proposeDocumentTemplatePlan(documentText: string) {
  const { output } = await prompt({ documentText });
  if (!output) throw new Error("A IA não devolveu um plano estruturado.");
  return output;
}
