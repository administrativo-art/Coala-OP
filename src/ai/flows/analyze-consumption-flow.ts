
import { ai, DEFAULT_MODEL } from '../genkit';
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
    const consumptionAnalysisPrompt = ai.definePrompt(
        {
            name: 'consumptionAnalysisPrompt',
            model: DEFAULT_MODEL,
            input: { schema: ConsumptionAnalysisInputSchema },
            output: { schema: ConsumptionAnalysisOutputSchema },
            prompt: getActiveSystemPrompt("operations.consumption-analysis").render({}),
        },
    );

    const { output } = await consumptionAnalysisPrompt(input);
    return output!;
}
