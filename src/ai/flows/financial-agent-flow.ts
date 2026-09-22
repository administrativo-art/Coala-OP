import "server-only";
import { ai, DEFAULT_MODEL } from "@/ai/genkit";
import { assertAiEnabled } from "@/ai/guard";
import { getActiveSystemPrompt } from "@/ai/prompts/registry";
import { financialAgentPrioritySchema } from "@/features/financial/agent/contracts";
import type { FinancialAgentPriorityInput } from "@/features/financial/agent/service";

export async function prioritizeFinancialAgentActions(input: FinancialAgentPriorityInput, signal?: AbortSignal) {
  assertAiEnabled("financial-agent-read");
  const { output } = await ai.generate({
    model: DEFAULT_MODEL,
    abortSignal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]),
    system: getActiveSystemPrompt("financial.agent").render({}),
    prompt: JSON.stringify(input),
    output: { schema: financialAgentPrioritySchema },
    config: { temperature: 0, maxOutputTokens: 300 },
  });
  return output;
}
