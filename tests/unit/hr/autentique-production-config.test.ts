import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appHosting = readFileSync(resolve(repositoryRoot, "apphosting.yaml"), "utf8");

function configuredValue(variable: string) {
  return appHosting.match(
    new RegExp(`- variable: ${variable}\\n    value: "([^"]+)"`),
  )?.[1] ?? null;
}

test("publica o Autentique no ambiente oficial com dupla confirmação explícita", () => {
  assert.equal(configuredValue("AUTENTIQUE_SANDBOX"), "false");
  assert.equal(configuredValue("AUTENTIQUE_ALLOW_PRODUCTION"), "true");
  assert.match(
    appHosting,
    /- variable: AUTENTIQUE_API_TOKEN\n    secret: AUTENTIQUE_API_TOKEN(?:\n|$)/,
  );
});
