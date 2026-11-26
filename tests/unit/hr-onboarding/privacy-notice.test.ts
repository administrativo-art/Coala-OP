import assert from "node:assert/strict";
import test from "node:test";

import {
  ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT,
  ONBOARDING_ALLERGY_CONFIRMATION_NOTE,
  ONBOARDING_DATA_CONTROLLER_CNPJ,
  ONBOARDING_DATA_CONTROLLER_NAME,
  ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT,
  ONBOARDING_PRIVACY_CHANNEL,
  ONBOARDING_PRIVACY_NOTICE_SNAPSHOT_ID,
  ONBOARDING_PRIVACY_NOTICE_TEXT,
  ONBOARDING_PRIVACY_NOTICE_VERSION,
} from "../../../src/lib/hr/onboarding-privacy";

test("publishes the formalization notice with controller identity and privacy channel", () => {
  assert.equal(ONBOARDING_PRIVACY_NOTICE_VERSION, "1.1");
  assert.equal(ONBOARDING_PRIVACY_NOTICE_SNAPSHOT_ID, "formalization_1_1");
  assert.match(ONBOARDING_PRIVACY_NOTICE_TEXT, /^AVISO DE PRIVACIDADE DA FORMALIZAÇÃO DE CANDIDATOS\n\nVersão 1\.1\n/);
  assert.match(ONBOARDING_PRIVACY_NOTICE_TEXT, /serviços de inteligência artificial utilizados para leitura, classificação e organização dos documentos enviados, sem decisão final automática/);
  assert.match(ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT, /versão 1\.1,/);
  assert.equal(ONBOARDING_DATA_CONTROLLER_NAME, "CT SORVETES LTDA.");
  assert.equal(ONBOARDING_DATA_CONTROLLER_CNPJ, "14.276.603/0001-25");
  assert.equal(ONBOARDING_PRIVACY_CHANNEL, "administrativo@coalashakes.com");
  assert.match(ONBOARDING_PRIVACY_NOTICE_TEXT, /A ciência deste Aviso não será utilizada como consentimento/);
  assert.match(ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT, /registros técnicos do procedimento/);
});

test("records allergy transparency as acknowledgement instead of consent", () => {
  assert.match(ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT, /^Estou ciente/);
  assert.match(ONBOARDING_ALLERGY_CONFIRMATION_NOTE, /não constitui consentimento/);
  assert.doesNotMatch(ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT, /^Autorizo/);
});
