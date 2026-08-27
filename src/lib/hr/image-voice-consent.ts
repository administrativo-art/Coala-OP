import { createHash } from "node:crypto";

export const IMAGE_VOICE_CONSENT_VERSION = "1.0";
export const IMAGE_VOICE_CONSENT_EFFECTIVE_AT = "2026-07-19";
export const IMAGE_VOICE_CONSENT_SNAPSHOT_ID = "image_voice_consent_1_0";

export const IMAGE_VOICE_CONSENT_TITLE = "Uso de imagem e voz (opcional)";
export const IMAGE_VOICE_CONSENT_EXPLANATION =
  "Esta opção é facultativa e não afeta sua contratação nem seu vínculo de trabalho. Você pode mudar de ideia depois.";
export const IMAGE_VOICE_CONSENT_CHECKBOX_TEXT =
  "Autorizo o uso da minha imagem e da minha voz para divulgação da empresa, conforme o Termo de Consentimento para Uso de Imagem e Voz.";

export const IMAGE_VOICE_CONSENT_TERM_TEXT = `TERMO DE CONSENTIMENTO PARA USO DE IMAGEM E VOZ

Versão 1.0
Data de vigência: 19/07/2026

De forma livre, informada, facultativa e específica, o titular poderá autorizar a Coala Shakes a utilizar sua imagem e sua voz em materiais de divulgação institucional da empresa, inclusive em canais digitais próprios.

A autorização é opcional, não constitui requisito para contratação, não afeta o vínculo de trabalho e pode ser revogada a qualquer momento. Após a revogação, a empresa adotará providências para remover, em prazo razoável, os materiais dos canais digitais próprios sob seu controle. A revogação não alcança materiais impressos que já tenham sido distribuídos anteriormente.`;

export function imageVoiceConsentTermHash() {
  return createHash("sha256")
    .update([
      IMAGE_VOICE_CONSENT_VERSION,
      IMAGE_VOICE_CONSENT_TITLE,
      IMAGE_VOICE_CONSENT_EXPLANATION,
      IMAGE_VOICE_CONSENT_CHECKBOX_TEXT,
      IMAGE_VOICE_CONSENT_TERM_TEXT,
    ].join("\n"), "utf8")
    .digest("hex");
}

export function publicImageVoiceConsentTerm() {
  return {
    version: IMAGE_VOICE_CONSENT_VERSION,
    hash: imageVoiceConsentTermHash(),
    title: IMAGE_VOICE_CONSENT_TITLE,
    explanation: IMAGE_VOICE_CONSENT_EXPLANATION,
    checkboxText: IMAGE_VOICE_CONSENT_CHECKBOX_TEXT,
    termText: IMAGE_VOICE_CONSENT_TERM_TEXT,
  };
}

export function parseImageVoiceConsentDecision(input: unknown) {
  const term = publicImageVoiceConsentTerm();
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const authorized = value.authorized;
  const valid = typeof authorized === "boolean"
    && value.termVersion === term.version
    && value.termHash === term.hash;
  return {
    valid,
    authorized: authorized === true,
    term,
  };
}
