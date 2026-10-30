import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

import { SYSTEM_DOCUMENT_TEMPLATES } from "../../src/features/hr/documents/system-template-catalog";

test("catálogo de configurações lista todo modelo gerável e exclui somente referências", () => {
  const generated = SYSTEM_DOCUMENT_TEMPLATES.filter((template) => template.generationMode !== "reference");
  assert.equal(generated.length, SYSTEM_DOCUMENT_TEMPLATES.length - 1);
  assert.equal(generated.some((template) => template.id === "system-letterhead-blank"), false);
  assert.equal(generated.some((template) => template.id === "system-post-admission-transportation-voucher-reactivation"), true);
  assert.ok(generated.every((template) => template.version > 0 && Boolean(template.retentionPolicyId)));
});

test("Configurações Pessoal reúne geração, publicação e modelos sem duplicar a implementação", async () => {
  const [settingsSource, catalogSource, templatesSource, templateDetailSource, settingsDetailRoute, sidebarSource, instructions, registryGuide, harness] = await Promise.all([
    readFile(path.join(process.cwd(), "src/app/dashboard/settings/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/settings/generated-documents-settings.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/app/dashboard/documents/templates/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/app/dashboard/documents/templates/[id]/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/app/dashboard/settings/documents/templates/[id]/page.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/sidebar.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "AGENTS.md"), "utf8"),
    readFile(path.join(process.cwd(), "docs/engineering/generated-documents-registry.md"), "utf8"),
    readFile(path.join(process.cwd(), "docs/engineering/generated-documents-harness.md"), "utf8"),
  ]);
  assert.match(settingsSource, /value: "generated-documents"/);
  assert.match(settingsSource, /value: "documents"/);
  assert.match(settingsSource, /label: "Documentos"/);
  assert.match(settingsSource, /label: "Geração e publicação"/);
  assert.match(settingsSource, /value: "document-templates"/);
  assert.match(settingsSource, /label: "Modelos"/);
  assert.match(settingsSource, /<DocumentTemplatesSettings \/>/);
  assert.match(settingsSource, /department=pessoal&tab=generated-documents/);
  assert.match(catalogSource, /name: "Pacote admissional"/);
  assert.match(catalogSource, /Política atual/);
  assert.match(catalogSource, /Não configurada — permanece restrito/);
  assert.match(templatesSource, /const embedded = pathname\.startsWith\("\/dashboard\/settings"\)/);
  assert.match(templatesSource, /embedded \? "py-4" : "py-5"/);
  assert.match(templatesSource, /router\.replace\("\/dashboard\/settings\?department=pessoal&tab=document-templates"\)/);
  assert.match(templatesSource, /router\.push\(`\/dashboard\/settings\/documents\/templates\/\$\{encodeURIComponent\(template\.id\)\}`\)/);
  assert.match(templateDetailSource, /\/dashboard\/settings\/documents\/templates/);
  assert.match(settingsDetailRoute, /dashboard\/documents\/templates\/\[id\]\/page/);
  assert.doesNotMatch(sidebarSource, /href: "\/dashboard\/documents\/templates"/);
  assert.match(instructions, /SYSTEM_DOCUMENT_TEMPLATES/);
  assert.match(instructions, /Configurações → Pessoal → Documentos/);
  assert.match(instructions, /Gerador persistente sem catálogo bloqueia commit e rollout/);
  assert.match(registryGuide, /harness de documentos gerados/);
  assert.match(registryGuide, /ordem, relatório, espelho, comprovante, pacote/);
  assert.match(harness, /Documento persistente gerado sem catálogo/);
  assert.match(harness, /generationMode: "reference"/);
});
