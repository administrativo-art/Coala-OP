
import { generateStructuredOutput } from '@/ai/google-genai';
import { getActiveSystemPrompt } from '@/ai/prompts/registry';
import {
    ConsumptionAnalysisInputSchema,
    ConsumptionAnalysisOutputSchema,
    type ConsumptionDataItemSchema
} from './consumption-schemas';
import { z } from 'zod';

export async function analyzeConsumption(
    input: z.infer<typeof ConsumptionAnalysisInputSchema>
): Promise<z.infer<typeof ConsumptionAnalysisOutputSchema>> {
    return generateStructuredOutput({
        input,
        inputSchema: ConsumptionAnalysisInputSchema,
        outputSchema: ConsumptionAnalysisOutputSchema,
        promptTemplate: getActiveSystemPrompt("operations.consumption-analysis").render({}),
    });
}
