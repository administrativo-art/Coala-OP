import Handlebars from "handlebars";
import type { ZodType } from "zod";

export function renderPromptTemplate(template: string, input: unknown): string {
  return Handlebars.compile(template, { noEscape: true })(input);
}

export function parseStructuredOutput<T>(schema: ZodType<T>, responseText: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("A IA não devolveu um JSON válido.");
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new Error("A IA devolveu um JSON incompatível com o formato esperado.");
  }
  return validated.data;
}
