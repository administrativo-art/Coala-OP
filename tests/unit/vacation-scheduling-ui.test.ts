import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manager = readFileSync('src/components/dp/dp-ferias-manager.tsx', 'utf8');
const drawer = readFileSync('src/components/dp/dp-ferias-drawer.tsx', 'utf8');
const profile = readFileSync('src/components/dp/dp-ferias-profile.tsx', 'utf8');
const workflow = readFileSync('src/components/dp/dp-vacation-workflow.tsx', 'utf8');
const editor = readFileSync('src/components/dp/dp-vacation-editor-panel.tsx', 'utf8');
const timeline = readFileSync('src/components/dp/dp-vacation-timeline.tsx', 'utf8');

test('fila de prioridade exclui ciclos agendados e pendentes apenas de aprovação', () => {
  assert.match(manager, /e\.health\.cycleStatus !== 'AGENDADO'/);
  assert.match(manager, /e\.health\.cycleStatus !== 'AGUARDANDO_APROVACAO'/);
  assert.match(manager, /Férias agendadas/);
  assert.match(manager, /Aguardando aprovação/);
  assert.match(manager, /riskFilter === 'ALL' && awaitingApproval\.length > 0/);
  assert.match(manager, /riskFilter === 'ALL' && scheduled\.length > 0/);
});

test('ciclo sem saldo não oferece novo lançamento no drawer ou no perfil', () => {
  assert.match(drawer, /balance > 0 && canEdit/);
  assert.match(profile, /canEdit && cycle\.balance > 0/);
});

test('alerta de múltiplos ciclos ignora os que já estão totalmente distribuídos', () => {
  assert.match(drawer, /c\.status !== 'AGENDADO' && c\.status !== 'AGUARDANDO_APROVACAO'/);
});

test('perfil apresenta a trilha completa e preserva o recibo original para auditoria', () => {
  assert.match(profile, /DPVacationWorkflowPanel/);
  assert.match(workflow, /O que falta para avançar/i);
  assert.match(workflow, /Gerar e validar o aviso de férias/);
  assert.match(workflow, /Original do contador/);
  assert.match(workflow, /Bloqueado até o pagamento/);
  assert.match(workflow, /Finalizar no RH/);
});

test('drawer permite revisar e decidir agendamentos sem sair da lista', () => {
  assert.match(manager, /canApprove=\{canApprove\}/);
  assert.match(drawer, /DPVacationDecisionPanel/);
  assert.match(drawer, /Revisar e decidir/);
  assert.match(drawer, /record\.status === 'PENDING' \|\| record\.status === 'PLANNED'/);
});

test('decisão no drawer mantém aprovação e rejeição protegidas por permissão e justificativa', () => {
  const decisionPanel = readFileSync('src/components/dp/dp-vacation-decision-panel.tsx', 'utf8');
  assert.match(decisionPanel, /status: 'APPROVED'/);
  assert.match(decisionPanel, /json: \{ action: 'reject', reason: reason\.trim\(\) \}/);
  assert.match(decisionPanel, /reason\.trim\(\)\.length >= 10/);
  assert.match(decisionPanel, /hasBlockingIssue/);
  assert.match(decisionPanel, /Aprovar Férias/);
  assert.match(decisionPanel, /Aprovado por você/);
  assert.match(decisionPanel, /Rejeitado por você/);
});

test('painel implementa KPIs, filas operacionais e timeline do handoff', () => {
  assert.match(manager, /Pendente de agendamento/);
  assert.match(manager, /Prazo de aviso em risco/);
  assert.match(manager, /Em gozo neste mês/);
  assert.match(manager, /QueueRow/);
  assert.match(manager, /DPVacationTimeline/);
  assert.match(timeline, /Aprovada/);
  assert.match(timeline, /Planejada/);
  assert.match(timeline, /Pendente/);
});

test('drawer oferece cadastro, edição e exclusão do período conforme o handoff', () => {
  assert.match(drawer, /DPVacationEditorPanel/);
  assert.match(drawer, /Registrar neste ciclo/);
  assert.match(drawer, /Editar período lançado/);
  assert.match(drawer, /Excluir período lançado/);
  assert.match(drawer, /record\.workflow\?\.legalAnalysis\.noticeLeadDays/);
  assert.match(drawer, /label: 'No prazo'/);
  assert.match(drawer, /Aviso fora do prazo/);
  assert.match(drawer, /records\.filter\(r => r\.status !== 'REJECTED'\)/);
  assert.match(editor, /Salvar lançamento/);
  assert.match(editor, /Aviso de férias com menos de 30 dias/);
  assert.match(editor, /returnDate/);
  assert.match(editor, /status: record\?\.status \?\? 'PENDING'/);
});

test('ficha sem lançamento explica as três fases e antecipa as sete etapas', () => {
  assert.match(workflow, /Passo 1 de 3/);
  assert.match(workflow, /Registrar o período/);
  assert.match(workflow, /Aprovar o agendamento/);
  assert.match(workflow, /As 7 etapas que vêm depois da aprovação/);
});
