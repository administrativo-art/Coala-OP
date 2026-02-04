'use server';

import { genkit } from '@genkit-ai/core';
import { googleAI } from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
});
