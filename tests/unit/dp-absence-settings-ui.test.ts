import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const settings = fs.readFileSync('src/app/dashboard/settings/page.tsx', 'utf8');
const component = fs.readFileSync('src/components/dp/dp-settings-absences.tsx', 'utf8');
const access = fs.readFileSync('src/features/dp/time-config/access.server.ts', 'utf8');

test('ausências integra a navegação de Pessoal → Tempo entre turnos e hora extra', () => {
  // Tempo termina na exportação fiscal (AFD e AEJ), que saiu do fechamento do ponto.
  assert.match(settings, /pickPersonalTabs\(\["work-journeys", "shifts", "absences", "overtime", "calendars", "fiscal-exports"\]\)/);
  assert.match(settings, /label: "Ausências"/);
});

test('etapa 1 explica seu limite e oferece simulação sem efetivar solicitação', () => {
  assert.match(component, /Ainda não recebe solicitações, bloqueia escalas, lança ponto ou gera folha/);
  assert.match(component, /Simular regra/);
  assert.match(component, /Não cria solicitação/);
});

test('cadastro explica blocos por popover, alinha grades e torna a hierarquia de aprovação explícita', () => {
  assert.match(component, /InfoPopover title="Pedido e efeito na operação"/);
  assert.match(component, /Você pode habilitar Dias, Horas ou as duas opções/);
  assert.match(component, /Ausência justificada:[\s\S]*Ausência não justificada:[\s\S]*Crédito como período trabalhado:[\s\S]*Débito em banco de horas:[\s\S]*Revisão manual:/);
  assert.match(component, /Não determina, sozinho, pagamento ou desconto em folha/);
  assert.match(component, /InfoPopover title="Campos e opções das regras"/);
  assert.match(component, /Regras deste tipo/);
  assert.match(component, /Regra <span aria-hidden="true">•<\/span> \{index \+ 1\}/);
  assert.match(component, /setEditorTab\(nextIndex\)/);
  assert.match(component, /editorTab === index/);
  assert.match(component, /todas as regras abaixo pertencem somente a/);
  assert.match(component, /Elas não se aplicam aos demais tipos de ausência/);
  assert.match(component, /Público e abrangência da regra/);
  assert.match(component, /Contagem e fluxo de aprovação/);
  assert.match(component, /Limites, prazos e anexo/);
  assert.match(component, /Rejeição, edição e cancelamento/);
  assert.match(component, /Dias de trabalho previstos:[\s\S]*Dias corridos:[\s\S]*Dias corridos até o retorno:/);
  assert.match(component, /Automática:[\s\S]*Gestor:[\s\S]*Departamento Pessoal:[\s\S]*Gestor e depois DP:/);
  assert.match(component, /\[&>div>label\]:min-h-8/);
  assert.match(component, /ApprovalFlowPreview/);
  assert.match(component, /Gestor direto[\s\S]*Departamento Pessoal/);
  assert.match(component, /Sem gestor direto válido, a solicitação não avança automaticamente/);
  assert.match(component, /Gerar instruções a partir da regra/);
  assert.match(component, /Registre a solicitação de/);
  assert.match(component, /maximumRetroactiveDays/);
  assert.match(component, /red: 'bg-red-500'/);
  assert.match(component, /orange: 'bg-orange-500'/);
  assert.match(component, /teal: 'bg-teal-500'/);
  assert.match(component, /indigo: 'bg-indigo-500'/);
});

test('a API exige permissão própria e acesso global', () => {
  assert.match(access, /manageAbsences/);
  assert.match(access, /DP_ABSENCE_GLOBAL_SCOPE_REQUIRED/);
});
