import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_BLOCK_KEYS,
  systemFieldsRepresentedByProfileBlocks,
} from "../../src/features/hr/lib/collaborator-system-fields";

test("campos operacionais do sistema aparecem no configurador apenas por meio do bloco nativo", () => {
  const represented = systemFieldsRepresentedByProfileBlocks([
    "system.schedule_units",
    "system.uniforms",
    "system.vacations",
    "system.aso_control",
    "system.family_salary",
    "system.transport_voucher",
    "system.behavior",
  ]);

  for (const fieldKey of Object.values(SYSTEM_BLOCK_KEYS).flat()) {
    assert.equal(represented.has(fieldKey), true, fieldKey);
  }
});

test("blocos ausentes não ocultam campos sem uma representação substituta", () => {
  const represented = systemFieldsRepresentedByProfileBlocks(["system.uniforms", "unknown.block"]);

  assert.deepEqual([...represented], [...SYSTEM_BLOCK_KEYS.uniforms]);
  assert.equal(represented.has(SYSTEM_BLOCK_KEYS.vacations[0]), false);
});
