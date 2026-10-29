import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(process.cwd(), "src/components/user-management.tsx"),
  "utf8",
);
const editPageSource = readFileSync(
  path.join(process.cwd(), "src/app/dashboard/dp/collaborators/[userId]/edit/page.tsx"),
  "utf8",
);
const profilePageSource = readFileSync(
  path.join(process.cwd(), "src/app/dashboard/dp/collaborators/[userId]/page.tsx"),
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

test("o formulário usa o catálogo central, que inclui o vínculo societário", () => {
  assert.match(source, /EMPLOYMENT_RELATIONSHIP_TYPES\.map/);
  assert.match(source, /'partner'/);
});

test("a edição completa segue o padrão de drawer com abas e ajuda explicativa", () => {
  assert.match(editPageSource, /\?panel=edit-data/);
  assert.match(profilePageSource, /<SidePanel/);
  assert.match(profilePageSource, /className="w-\[min\(920px,100vw\)\]"/);
  assert.match(profilePageSource, /presentation="drawer"/);
  assert.match(profilePageSource, /Descartar alterações\?/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /title="Identificação"/);
  assert.match(source, /title="Dados contratuais"/);
  assert.match(source, /title="Jornada"/);
  assert.match(source, /title="Unidades"/);
  assert.doesNotMatch(source, /title="Comportamento no sistema"/);
  assert.match(source, /type CollaboratorEditTab = 'identity' \| 'journey' \| 'units';/);
  assert.doesNotMatch(source, /\{ id: 'system', label: 'Sistema' \}/);
  assert.match(source, /shiftDefinitionId: 'journey'/);
  assert.match(source, /jobRoleId: 'identity'/);
  assert.match(source, /jobFunctionIds: 'identity'/);
  assert.match(source, /unitId: 'units'/);
  assert.match(source, /employerUnitId: 'units'/);
  assert.doesNotMatch(source, /Como ler esta tela/);
  assert.match(source, /assignedKioskIds: 'units'/);
  assert.match(source, /profileId: 'journey'/);
  assert.doesNotMatch(source, /name="operacional"|name="participatesInGoals"/);
  assert.match(source, /isDrawer \? 'bottom-0 mt-auto' : 'bottom-4'/);
  assert.match(source, /<InfoPopover/);
});
