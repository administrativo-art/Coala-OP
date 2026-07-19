import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_VOICE_CONSENT_CHECKBOX_TEXT,
  IMAGE_VOICE_CONSENT_EXPLANATION,
  IMAGE_VOICE_CONSENT_TITLE,
  IMAGE_VOICE_CONSENT_VERSION,
  imageVoiceConsentTermHash,
  parseImageVoiceConsentDecision,
  publicImageVoiceConsentTerm,
} from "../../../src/lib/hr/image-voice-consent";

test("publica o consentimento de imagem e voz como facultativo e específico", () => {
  assert.match(IMAGE_VOICE_CONSENT_TITLE, /imagem e voz/i);
  assert.match(IMAGE_VOICE_CONSENT_TITLE, /opcional/i);
  assert.match(IMAGE_VOICE_CONSENT_EXPLANATION, /facultativa/i);
  assert.match(IMAGE_VOICE_CONSENT_EXPLANATION, /não afeta.*contratação/i);
  assert.match(IMAGE_VOICE_CONSENT_CHECKBOX_TEXT, /Autorizo.*imagem.*voz/i);
  assert.doesNotMatch(IMAGE_VOICE_CONSENT_CHECKBOX_TEXT, /aceito os termos/i);
});

test("aceita explicitamente tanto autorização true quanto false", () => {
  const term = publicImageVoiceConsentTerm();
  const denied = parseImageVoiceConsentDecision({
    authorized: false,
    termVersion: term.version,
    termHash: term.hash,
  });
  const granted = parseImageVoiceConsentDecision({
    authorized: true,
    termVersion: term.version,
    termHash: term.hash,
  });

  assert.equal(denied.valid, true);
  assert.equal(denied.authorized, false);
  assert.equal(granted.valid, true);
  assert.equal(granted.authorized, true);
  assert.equal(parseImageVoiceConsentDecision(undefined).valid, false);
});

test("expõe versão e hash estáveis do termo exibido", () => {
  const term = publicImageVoiceConsentTerm();
  assert.equal(term.version, IMAGE_VOICE_CONSENT_VERSION);
  assert.equal(term.hash, imageVoiceConsentTermHash());
  assert.match(term.hash, /^[a-f0-9]{64}$/);
  assert.match(term.termText, /revogada a qualquer momento/i);
  assert.match(term.termText, /materiais impressos.*distribuídos/i);
});
