import assert from "node:assert/strict";
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
