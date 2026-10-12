import { generateStructuredOutput } from '@/ai/google-genai';
import { getActiveSystemPrompt } from '@/ai/prompts/registry';
import {
    GoalsAnalysisInputSchema,
    GoalsAnalysisOutputSchema,
} from './goals-schemas';
import { z } from 'zod';

export async function analyzeGoals(
    input: z.infer<typeof GoalsAnalysisInputSchema>
): Promise<z.infer<typeof GoalsAnalysisOutputSchema>> {
    return generateStructuredOutput({
        input,
        inputSchema: GoalsAnalysisInputSchema,
        outputSchema: GoalsAnalysisOutputSchema,
        promptTemplate: getActiveSystemPrompt("commercial.goals-analysis").render({}),
    });
}
