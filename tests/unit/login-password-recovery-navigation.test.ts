import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const loginPageSource = readFileSync(
  path.join(process.cwd(), "src/app/login/page.tsx"),
  "utf8",
);

const forgotPasswordPageSource = readFileSync(
  path.join(process.cwd(), "src/app/forgot-password/page.tsx"),
  "utf8",
);

test("login exposes the password recovery flow", () => {
  assert.match(loginPageSource, /href=["']\/forgot-password["']/);
  assert.match(loginPageSource, /Esqueci minha senha/);
});

test("password recovery lets the user return to login", () => {
  assert.match(forgotPasswordPageSource, /href=["']\/login["']/);
  assert.match(forgotPasswordPageSource, /Voltar para o login/);
});
