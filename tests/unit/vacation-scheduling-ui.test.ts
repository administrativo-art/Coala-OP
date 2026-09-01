import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manager = readFileSync('src/components/dp/dp-ferias-manager.tsx', 'utf8');
const drawer = readFileSync('src/components/dp/dp-ferias-drawer.tsx', 'utf8');
const profile = readFileSync('src/components/dp/dp-ferias-profile.tsx', 'utf8');
const workflow = readFileSync('src/components/dp/dp-vacation-workflow.tsx', 'utf8');

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
