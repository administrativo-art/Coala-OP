import assert from "node:assert/strict";
import test from "node:test";

import {
  closeOnboardingPublicLink,
  createOnboardingPublicLinkWindow,
  extendOnboardingPublicLink,
  ONBOARDING_PUBLIC_FORM_SUBMITTED_MESSAGE,
  onboardingPublicLinkClosedMessage,
  onboardingPublicLinkExpired,
  onboardingPublicLinkExpiresAt,
} from "../../../src/lib/hr/onboarding-public-link";

test("creates a public onboarding link valid for 72 hours", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const window = createOnboardingPublicLinkWindow(now);

  assert.equal(window.publicTokenExpiresAt, "2026-07-19T12:00:00.000Z");
  assert.equal(window.publicTokenExtensionUsed, false);
  assert.equal(onboardingPublicLinkExpired(window, now), false);
});

test("falls back to 72 hours from creation for legacy processes", () => {
  const data = { createdAt: "2026-07-16T12:00:00.000Z" };
  assert.equal(onboardingPublicLinkExpiresAt(data)?.toISOString(), "2026-07-19T12:00:00.000Z");
});

test("extends an active link once by 24 hours", () => {
  const data = {
    publicTokenExpiresAt: "2026-07-19T12:00:00.000Z",
    publicTokenExtensionUsed: false,
  };
  const extended = extendOnboardingPublicLink(data, new Date("2026-07-18T12:00:00.000Z"));
  assert.equal(extended, "2026-07-20T12:00:00.000Z");
  assert.equal(extendOnboardingPublicLink({ ...data, publicTokenExtensionUsed: true }), null);
});

test("an expired link receives 24 hours from the extension time", () => {
  const data = {
    publicTokenExpiresAt: "2026-07-16T11:00:00.000Z",
    publicTokenExtensionUsed: false,
  };
  const now = new Date("2026-07-16T12:00:00.000Z");
  assert.equal(onboardingPublicLinkExpired(data, now), true);
  assert.equal(extendOnboardingPublicLink(data, now), "2026-07-17T12:00:00.000Z");
});

test("closes the initial link after the form is submitted", () => {
  const now = new Date("2026-08-24T20:00:00.000Z");
  const closed = closeOnboardingPublicLink(now);

  assert.deepEqual(closed, {
    publicTokenClosedAt: "2026-08-24T20:00:00.000Z",
    publicTokenClosedReason: "form_submitted",
  });
  assert.equal(onboardingPublicLinkClosedMessage({ ...closed }), ONBOARDING_PUBLIC_FORM_SUBMITTED_MESSAGE);
  assert.equal(onboardingPublicLinkClosedMessage({ publicTokenClosedAt: null }), null);
});

test("shows the submitted message for legacy closures with a submitted form", () => {
  assert.equal(onboardingPublicLinkClosedMessage({
    publicTokenClosedAt: "2026-08-24T20:00:00.000Z",
    publicFormSubmittedAt: "2026-08-24T19:59:00.000Z",
  }), ONBOARDING_PUBLIC_FORM_SUBMITTED_MESSAGE);
});
