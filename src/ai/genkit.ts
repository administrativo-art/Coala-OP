import "server-only";

import { genkit } from 'genkit';
import { googleAI } from "@genkit-ai/google-genai";

// Instância do Genkit
export const ai = genkit({
  plugins: [googleAI()],
});

// Modelo padrão do projeto (explícito)
export const DEFAULT_MODEL = "googleai/gemini-2.5-pro";