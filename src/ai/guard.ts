export function assertAiEnabled(featureName: string) {
  if (process.env.ENABLE_AI_FEATURES !== "true") {
    throw new Error(
      `Recursos de IA desativados temporariamente. Recurso bloqueado: ${featureName}.`
    );
  }
}
