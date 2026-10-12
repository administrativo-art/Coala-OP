import "server-only";
import { generateStructuredOutput } from "@/ai/google-genai";
import { assertAiEnabled } from "@/ai/guard";
import { getActiveSystemPrompt } from "@/ai/prompts/registry";
import { financialAgentPrioritySchema } from "@/features/financial/agent/contracts";
import type { FinancialAgentPriorityInput } from "@/features/financial/agent/service";

export async function prioritizeFinancialAgentActions(input: FinancialAgentPriorityInput, signal?: AbortSignal) {
  assertAiEnabled("financial-agent-read");
  return generateStructuredOutput({
    input,
    outputSchema: financialAgentPrioritySchema,
    systemInstruction: getActiveSystemPrompt("financial.agent").render({}),
    abortSignal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]),
    temperature: 0,
    maxOutputTokens: 300,
  });
}
