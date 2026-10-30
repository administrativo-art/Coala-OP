import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_COMPOSITE_FIELDS,
  buildProfileDisplayItems,
  composeResidentialAddress,
  groupProfileSection,
} from "../../src/features/rh/lib/profile-field-layout";
import { DOCUMENT_VARIABLE_CATALOG } from "../../src/features/hr/integration/document-variables";

const composite = (id: string) => {
  const def = PROFILE_COMPOSITE_FIELDS.find((item) => item.id === id);
  assert.ok(def, id);
  return def;
};
const textOf = (values: Record<string, string | null>) => (key: string) => values[key] ?? null;

test("logradouro mostra o número quando existe e s/n quando não existe", () => {
  const def = composite("composite.street_number");
  assert.equal(def.format(textOf({ "employee.address_street": "Rua A", "employee.address_number": "12", "employee.address_no_number": "Sim" })), "Rua A, 12");
  assert.equal(def.format(textOf({ "employee.address_street": "Rua A" })), "Rua A, s/n");
  assert.equal(def.format(textOf({})), null);
  assert.deepEqual(def.deriveOnSave?.({ "employee.address_number": " 12 " }), { "employee.address_no_number": "false" });
  assert.deepEqual(def.deriveOnSave?.({ "employee.address_number": "" }), { "employee.address_no_number": "true" });
});

test("cidade e UF, Pix e benefícios viram um cartão só", () => {
  assert.equal(composite("composite.city_state").format(textOf({ "employee.city": "São Luís", "employee.state": "MA" })), "São Luís | MA");
  assert.equal(composite("composite.pix").format(textOf({ "employee.pix_key_type": "CPF", "employee.pix_key": "123" })), "CPF · 123");
  const vt = composite("composite.transport_voucher");
  assert.equal(vt.format(textOf({ "employee.has_vt": "Sim", "employee.vt_daily_value": "R$ 10,00" })), "Sim · R$ 10,00/dia");
  assert.equal(vt.format(textOf({ "employee.has_vt": "Não", "employee.vt_daily_value": "R$ 10,00" })), "Não");
});

test("dados pessoais são divididos em subgrupos e nada some", () => {
  const rows = [
    "employee.name",
    "employee.state",
    "employee.city",
    "employee.address",
    "employee.mother_name",
    "employee.father_name",
    "employee.employer_name",
    "employee.address_zipcode",
    "employee.address_street",
    "employee.address_number",
    "employee.address_no_number",
    "employee.phone",
    "employee.cpf",
    "employee.campo_novo",
  ].map((key) => ({ key }));
  const items = buildProfileDisplayItems(rows);
  for (const hidden of ["employee.address", "employee.mother_name", "employee.father_name", "employee.employer_name"]) {
    assert.ok(!items.some((item) => item.key === hidden), `${hidden} não aparece na ficha`);
  }
  const groups = groupProfileSection("Dados pessoais", items);
  assert.ok(groups);
  assert.deepEqual(groups.map((group) => group.title), ["Identificação", "Contato", "Endereço residencial", "Documentos", "Outros dados"]);
  const address = groups.find((group) => group.id === "address");
  assert.deepEqual(address?.items.map((item) => item.key), ["employee.address_zipcode", "composite.street_number", "composite.city_state"]);
  assert.equal(groupProfileSection("Uniforme", items), null);
});

test("benefícios ficam em vale-transporte, alimentação e convênios", () => {
  const rows = ["employee.has_vt", "employee.vt_daily_value", "employee.vt_notes", "employee.has_va_vr", "employee.va_vr_daily_value", "employee.has_health_plan"].map((key) => ({ key }));
  const groups = groupProfileSection("Benefícios", buildProfileDisplayItems(rows));
  assert.deepEqual(groups?.map((group) => [group.title, group.items.map((item) => item.key)]), [
    ["Vale-transporte", ["composite.transport_voucher"]],
    ["Vale-alimentação / refeição", ["composite.meal_voucher"]],
    ["Convênios", ["employee.has_health_plan"]],
  ]);
});

test("o endereço dos documentos é montado a partir do endereço residencial", () => {
  assert.equal(
    composeResidentialAddress({ street: "Rua das Flores", number: "120", neighborhood: "Centro", city: "São Luís", state: "MA", zipcode: "65010000" }),
    "Rua das Flores, 120, Centro, São Luís/MA, CEP 65010-000",
  );
  assert.equal(composeResidentialAddress({ street: "Rua B", number: " ", complement: "Casa 2", city: "Paço" }), "Rua B, s/n, Casa 2, Paço");
  assert.equal(composeResidentialAddress({ number: "10", city: "São Luís" }), null);
  const resolution = DOCUMENT_VARIABLE_CATALOG["employee.address"]?.resolution;
  assert.deepEqual(resolution?.[0], { source: "computed", path: "address.full" });
  assert.deepEqual(resolution?.[1], { source: "field_value", path: "employee.address" });
});
