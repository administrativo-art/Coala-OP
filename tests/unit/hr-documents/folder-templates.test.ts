import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { groupOwnDocumentsByFolder } from "../../../src/features/hr/documents/own-document-folders";
import { employeeDossierTemplate } from "../../../src/lib/hr/employee-document-folder-templates";

describe("modelos de pasta por vínculo", () => {
  test("cria modelos distintos para PJ, CLT e estágio", () => {
    const pj = employeeDossierTemplate("pj")!;
    const clt = employeeDossierTemplate("clt")!;
    const internship = employeeDossierTemplate("internship")!;

    assert.equal(pj.label, "Prestadora PJ");
    assert.equal(clt.label, "Colaborador CLT");
    assert.equal(internship.label, "Estagiário");
    assert.notDeepEqual(pj.folders.map((folder) => folder.path), clt.folders.map((folder) => folder.path));
    assert.notDeepEqual(clt.folders.map((folder) => folder.path), internship.folders.map((folder) => folder.path));
    assert.equal(pj.folders.some((folder) => folder.path.includes("Admissão")), false);
    assert.equal(pj.folders.some((folder) => folder.path.join("/") === "Prestação de serviços PJ/Contrato principal"), true);
    for (const template of [pj, clt, internship]) {
      assert.equal(new Set(template.folders.map((folder) => folder.id)).size, template.folders.length);
      assert.equal(new Set(template.folders.map((folder) => `${folder.category}/${folder.path.join("/")}`)).size, template.folders.length);
    }
  });

  test("aprendiz usa estrutura CLT e societário não recebe modelo indevido", () => {
    assert.equal(employeeDossierTemplate("apprenticeship")?.id, "clt");
    assert.equal(employeeDossierTemplate("partner"), null);
  });

  test("a pasta pessoal materializa diretórios vazios do modelo", () => {
    const pj = employeeDossierTemplate("pj")!;
    const folders = groupOwnDocumentsByFolder([], pj.folders);
    assert.equal(folders.length, pj.folders.filter((folder) => folder.employeeVisible).length);
    assert.equal(folders.some((folder) => folder.path.join("/") === "Contratos/Prestação de serviços PJ/Aditivos"), true);
  });
});
