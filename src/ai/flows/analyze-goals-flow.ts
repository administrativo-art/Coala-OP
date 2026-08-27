import { ai, DEFAULT_MODEL } from '../genkit';
import { getActiveSystemPrompt } from '@/ai/prompts/registry';
import {
    GoalsAnalysisInputSchema,
    GoalsAnalysisOutputSchema,
} from './goals-schemas';
import { z } from 'zod';

const goalsAnalysisPrompt = ai.definePrompt(
    {
        name: 'goalsAnalysisPrompt',
        model: DEFAULT_MODEL,
        input: { schema: GoalsAnalysisInputSchema },
        output: { schema: GoalsAnalysisOutputSchema },
        prompt: getActiveSystemPrompt("commercial.goals-analysis").render({}),
    },
);

export async function analyzeGoals(
    input: z.infer<typeof GoalsAnalysisInputSchema>
): Promise<z.infer<typeof GoalsAnalysisOutputSchema>> {
    const { output } = await goalsAnalysisPrompt(input);
    return output!;
}
