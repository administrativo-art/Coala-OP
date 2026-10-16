import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/features/rh/components/FieldConfigPage.tsx", "utf8");
const feedbackGuide = readFileSync("docs/design/feedback.md", "utf8");
const fieldsGuide = readFileSync("docs/design/campos.md", "utf8");

test("seletor de visibilidade explica cada opção dentro do próprio painel", () => {
  assert.match(source, /const VISIBILITY_HELP/);
  assert.match(source, /VISIBILITIES\.map\(\(option\)/);
  assert.match(source, /InfoTooltip title=\{VISIBILITY_HELP\[option\]\.title\}/);
  assert.doesNotMatch(source, /title="Visibilidade da seção"[\s\S]{0,160}<InfoTooltip/);
});

test("dropdowns de configuração usam chevron próprio em vez da seta nativa", () => {
  assert.match(source, /function StyledSelect/);
  assert.match(source, /appearance-none pr-12/);
  assert.match(source, /<ChevronDown className="h-4 w-4"/);
  assert.match(source, /<StyledSelect[\s\S]*?id="profile-field-type"/);
  assert.match(fieldsGuide, /\*\*Dropdown \/ select\*\*/);
  assert.match(fieldsGuide, /`appearance: none`/);
  assert.match(fieldsGuide, /`ChevronDown` de 16px/);
});

test("barra de alterações pendentes acompanha a janela e possui contrato de design", () => {
  assert.match(source, /pointer-events-none fixed inset-x-3/);
  assert.doesNotMatch(source, /pointer-events-none sticky bottom/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(feedbackGuide, /## Barra de alterações pendentes/);
  assert.match(feedbackGuide, /fica `fixed` no rodapé da janela/);
});
