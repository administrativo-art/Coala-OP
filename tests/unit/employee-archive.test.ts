import assert from "node:assert/strict";
import test from "node:test";
import { employeeArchiveChildFolders, employeeArchiveIds } from "../../src/lib/documents/employee-archive";

test("consulta apenas os identificadores explicitamente vinculados e elimina duplicados", () => {
  assert.deepEqual(employeeArchiveIds({ id: "auth-1", hrEmployeeId: "rh-2", registrationIdBizneo: "rh-2" }), ["auth-1", "rh-2"]);
  assert.deepEqual(employeeArchiveIds({ id: "auth-1", hrEmployeeId: "  ", registrationIdBizneo: null }), ["auth-1"]);
});

test("árvore combina pastas vazias do perfil e arquivos sem misturar caminhos de outros ramos", () => {
  const paths = [["Identificação", "Documentos pessoais"], ["Identificação", "Dados bancários"], ["Documentos gerados"], ["Identificação", "Documentos pessoais", "CPF"]];
  assert.deepEqual(employeeArchiveChildFolders(paths, []), ["Identificação", "Documentos gerados"]);
  assert.deepEqual(employeeArchiveChildFolders(paths, ["Identificação"]), ["Documentos pessoais", "Dados bancários"]);
  assert.deepEqual(employeeArchiveChildFolders(paths, ["Documentos gerados"]), []);
});
