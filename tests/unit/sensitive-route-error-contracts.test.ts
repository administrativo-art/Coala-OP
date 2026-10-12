import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sensitiveRoutes = [
  "src/app/api/auth/last-login/route.ts",
  "src/app/api/auth/password-changed/route.ts",
  "src/app/api/webhooks/inter/cobranca/route.ts",
  "src/app/api/webhooks/inter/banking/route.ts",
  "src/app/api/financial/cash-deposits/inter/webhook/route.ts",
  "src/app/api/jobs/inter/cobrancas/reconcile/route.ts",
] as const;

test("prioritized auth and Inter routes use the sanitized security wrapper", async () => {
  const sources = await Promise.all(sensitiveRoutes.map((path) => readFile(path, "utf8")));
  for (const source of sources) {
    assert.match(source, /secureRoute/);
    assert.match(source, /errorExposure:\s*["']sanitized["']/);
    assert.doesNotMatch(source, /error\.message/);
    assert.doesNotMatch(source, /NextResponse\.json\(\s*\{\s*error:/);
  }
});

test("auth metadata writes are owner scoped and require an active user", async () => {
  const sources = await Promise.all(sensitiveRoutes.slice(0, 2).map((path) => readFile(path, "utf8")));
  for (const source of sources) {
    assert.match(source, /identity:\s*\{\s*kind:\s*["']active-user["']/);
    assert.match(source, /authorization:\s*\{\s*kind:\s*["']owner["']/);
    assert.match(source, /resourceScope:\s*\{\s*kind:\s*["']owner["']/);
    assert.match(source, /security\.resource\.ownerId/);
  }
});
