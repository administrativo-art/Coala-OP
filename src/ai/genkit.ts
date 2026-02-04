import "server-only";

import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

export const ai = genkit({
  plugins: [googleAI()],
});

export const DEFAULT_MODEL = "googleai/gemini-2.5-pro";
