import "server-only";

import { GoogleGenAI } from "@google/genai";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { parseStructuredOutput, renderPromptTemplate } from "@/ai/structured-output";

export const DEFAULT_MODEL = "gemini-2.5-flash";

type StructuredGenerationOptions<TInput, TOutput> = {
  input: TInput;
  inputSchema?: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  promptTemplate?: string;
  systemInstruction?: string;
  model?: string;
  abortSignal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
};

function resolveApiKey(): string {
  const apiKey = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  if (!apiKey) throw new Error("A integração Gemini não está configurada.");
  return apiKey;
}

export async function generateStructuredOutput<TInput, TOutput>(
  options: StructuredGenerationOptions<TInput, TOutput>,
): Promise<TOutput> {
  const input = options.inputSchema ? options.inputSchema.parse(options.input) : options.input;
  if (!options.promptTemplate && !options.systemInstruction) {
    throw new Error("A geração estruturada exige um prompt ou uma instrução de sistema.");
  }
  const contents = options.promptTemplate
    ? renderPromptTemplate(options.promptTemplate, input)
    : JSON.stringify(input);
  // `zod-to-json-schema` still publishes Zod 3's type surface while the app
  // uses Zod 4. Runtime conversion remains compatible; keep the boundary
  // explicit so TypeScript does not recursively compare the two Zod types.
  const jsonSchema = zodToJsonSchema(options.outputSchema as never, { $refStrategy: "none" });
  const client = new GoogleGenAI({ apiKey: resolveApiKey() });

  let responseText: string | undefined;
  try {
    const response = await client.models.generateContent({
      model: options.model ?? DEFAULT_MODEL,
      contents,
      config: {
        ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
      },
    });
    responseText = response.text;
  } catch (error) {
    if (options.abortSignal?.aborted) throw error;
    throw new Error("Não foi possível obter uma resposta do Gemini.", { cause: error });
  }

  if (!responseText) throw new Error("A IA não devolveu uma resposta estruturada.");
  return parseStructuredOutput(options.outputSchema, responseText);
}
