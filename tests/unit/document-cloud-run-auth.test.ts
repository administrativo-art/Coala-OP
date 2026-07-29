import assert from "node:assert/strict";
import test from "node:test";

import { cloudRunIdentityAuthorization } from "../../src/features/hr/documents/cloud-run-auth.server";

test("obtém identity token do metadata server com a audiência do Cloud Run", async () => {
  let requestedUrl = "";
  const authorization = await cloudRunIdentityAuthorization(
    "https://coala-gotenberg.example.run.app",
    async (input, init) => {
      requestedUrl = String(input);
      assert.equal(
        new Headers(init?.headers).get("Metadata-Flavor"),
        "Google",
      );
      return new Response("signed-token\n");
    },
  );

  const url = new URL(requestedUrl);
  assert.equal(
    url.searchParams.get("audience"),
    "https://coala-gotenberg.example.run.app",
  );
  assert.equal(url.searchParams.get("format"), "full");
  assert.equal(authorization, "Bearer signed-token");
});

test("não consulta metadata server quando não há audiência", async () => {
  const authorization = await cloudRunIdentityAuthorization(
    " ",
    async () => {
      throw new Error("não deveria chamar");
    },
  );
  assert.equal(authorization, null);
});

test("falha fechada quando o metadata server não emite token", async () => {
  await assert.rejects(
    cloudRunIdentityAuthorization(
      "https://coala-gotenberg.example.run.app",
      async () => new Response("forbidden", { status: 403 }),
    ),
    /identity token \(403\)/,
  );
});
