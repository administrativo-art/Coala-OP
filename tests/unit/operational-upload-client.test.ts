import assert from "node:assert/strict";
import test from "node:test";

import { uploadOperationalFile } from "../../src/lib/operational-upload-client";

test("preserva o contexto do usuário ao obter o token do upload", async (context) => {
  let receivedInit: RequestInit | undefined;
  context.mock.method(globalThis, "fetch", async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    receivedInit = init;
    return new Response(JSON.stringify({
      url: "https://storage.example/signature.png",
      path: "operations/signature.png",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const user = {
    token: "firebase-token",
    async getIdToken() {
      return this.token;
    },
  };

  const result = await uploadOperationalFile({
    user,
    kind: "reposition-signature",
    targetId: "activity-1",
    file: new File(["signature"], "signature.png", { type: "image/png" }),
  });

  assert.equal(new Headers(receivedInit?.headers).get("Authorization"), "Bearer firebase-token");
  assert.ok(receivedInit?.body instanceof FormData);
  assert.deepEqual(result, {
    url: "https://storage.example/signature.png",
    path: "operations/signature.png",
  });
});
