import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveOperatorAvatarUrls } from "../../src/features/financial/cash-closures/operator-avatars";

test("resolve a foto pelo operador PDV vinculado à unidade", () => {
  assert.deepEqual(resolveOperatorAvatarUrls({
    kioskId: "joao-paulo",
    operators: [{ id: "42", name: "Heucilene Oliveira" }],
    users: [{
      username: "Heucilene Oliveira",
      avatarUrl: "https://example.com/heucilene.jpg",
      pdvOperatorIds: { "joao-paulo": 42 },
    }],
  }), { "42": "https://example.com/heucilene.jpg" });
});

test("usa o nome apenas quando há uma única correspondência", () => {
  const duplicateUsers = [
    { username: "Maria Silva", avatarUrl: "https://example.com/1.jpg" },
    { username: "Maria Silva", avatarUrl: "https://example.com/2.jpg" },
  ];

  assert.deepEqual(resolveOperatorAvatarUrls({
    kioskId: "shopping",
    operators: [{ id: "99", name: "Maria Silva" }],
    users: duplicateUsers,
  }), {});
});

test("consulta somente candidatos limitados em vez de carregar todos os usuários", async () => {
  const serverSource = await readFile(
    new URL("../../src/features/financial/cash-closures/operator-avatars.server.ts", import.meta.url),
    "utf8",
  );
  const routeSource = await readFile(
    new URL("../../src/app/api/financial/cash-closures/[closureId]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(serverSource, /where\(new FieldPath\("pdvOperatorIds", input\.kioskId\), "in", ids\)/);
  assert.match(serverSource, /limit\(MAX_USERS_PER_QUERY \+ 1\)/);
  assert.doesNotMatch(routeSource, /collection\("users"\)[\s\S]*\.get\(\)/);
});
