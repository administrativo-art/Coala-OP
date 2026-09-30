import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrapRoute = readFileSync("src/app/api/financial/bootstrap/route.ts", "utf8");
const serverAccess = readFileSync("src/features/financial/lib/server-access.ts", "utf8");
const cloudFunctions = readFileSync("functions/src/index.ts", "utf8");
const financialRules = readFileSync("firestore.financial.rules", "utf8");

// O Firebase Auth rejeita custom claims acima de 1000 caracteres e a matriz financeira já passou disso.
test("permissões financeiras não trafegam em custom claims", () => {
  const claimWrites = cloudFunctions.match(/setCustomUserClaims\([^)]*\)/g) ?? [];
  assert.ok(claimWrites.length > 0);
  for (const write of claimWrites) assert.doesNotMatch(write, /financial/);

  assert.doesNotMatch(bootstrapRoute, /financial:\s*financialPermissions/);
  assert.doesNotMatch(bootstrapRoute, /decoded\.financial/);
  assert.doesNotMatch(serverAccess, /decoded\.financial/);
  assert.doesNotMatch(financialRules, /token\.get\('financial'|token\.financial/);
});
