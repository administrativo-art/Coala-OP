import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(process.cwd(), "src/components/user-management.tsx"),
  "utf8",
);

test("a edição de usuário torna falhas de validação e da API visíveis", () => {
  assert.match(source, /form\.handleSubmit\(onSubmit, onInvalidSubmit\)/);
  assert.match(source, /Existem campos obrigatórios pendentes\./);
  assert.match(source, /Não foi possível salvar as alterações\./);
});

test("o formulário recupera o vínculo canônico de colaboradores legados", () => {
  assert.match(source, /resolveEmploymentRelationshipType\(/);
  assert.match(source, /user\.personRecordType/);
});
