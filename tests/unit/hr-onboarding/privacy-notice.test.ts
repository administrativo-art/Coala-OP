import assert from "node:assert/strict";
import test from "node:test";

import {
  ONBOARDING_ALLERGY_ACKNOWLEDGEMENT_TEXT,
  ONBOARDING_ALLERGY_CONFIRMATION_NOTE,
  ONBOARDING_DATA_CONTROLLER_CNPJ,
  ONBOARDING_DATA_CONTROLLER_NAME,
  ONBOARDING_PRIVACY_ACKNOWLEDGEMENT_TEXT,
  ONBOARDING_PRIVACY_CHANNEL,
  ONBOARDING_PRIVACY_NOTICE_TEXT,
  ONBOARDING_PRIVACY_NOTICE_VERSION,
} from "../../../src/lib/hr/onboarding-privacy";

test("publishes the formalization notice with controller identity and privacy channel", () => {
  assert.equal(ONBOARDING_PRIVACY_NOTICE_VERSION, "1.0");
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
