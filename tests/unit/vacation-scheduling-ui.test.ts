import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manager = readFileSync('src/components/dp/dp-ferias-manager.tsx', 'utf8');
const drawer = readFileSync('src/components/dp/dp-ferias-drawer.tsx', 'utf8');
const profile = readFileSync('src/components/dp/dp-ferias-profile.tsx', 'utf8');
const workflow = readFileSync('src/components/dp/dp-vacation-workflow.tsx', 'utf8');
const editor = readFileSync('src/components/dp/dp-vacation-editor-panel.tsx', 'utf8');
const timeline = readFileSync('src/components/dp/dp-vacation-timeline.tsx', 'utf8');
const profilePage = readFileSync('src/app/dashboard/dp/ferias/[userId]/page.tsx', 'utf8');

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

test('trilha mostra uma etapa por vez e mantém etapas concluídas navegáveis', () => {
  assert.match(workflow, /stageSelection\?\.recordId === record\.id/);
  assert.match(workflow, /: workflow\.currentStage/);
  assert.match(workflow, /aria-pressed=\{selected\}/);
  assert.match(workflow, /setStageSelection\(\{ recordId: record\.id, stage: meta\.id \}\)/);
  assert.match(workflow, /selectedStage === 'scheduling'/);
  assert.match(workflow, /selectedStage === 'notice'/);
  assert.match(workflow, /selectedStage === 'accountant' \|\| selectedStage === 'receipt_review'/);
  assert.match(workflow, /selectedStage === 'payment' \|\| selectedStage === 'receipt_signature' \|\| selectedStage === 'closure'/);
  assert.match(workflow, /Etapa concluída\. Os dados permanecem disponíveis para consulta/);
});

test('perfil não reabre trilha para um período legado que já terminou', () => {
  assert.match(profile, /shouldDisplayVacationWorkflow\(vacation, today\)/);
});

test('painel separa consulta da ficha, registro direto e decisão individual', () => {
  assert.match(manager, /kind === 'scheduling' \? 'Registrar férias' : 'Abrir ficha'/);
  assert.match(manager, /kind="scheduling"[\s\S]*\?action=register/);
  assert.match(manager, /kind="approval"[\s\S]*router\.push\(`\/dashboard\/dp\/ferias/);
  assert.doesNotMatch(manager, /DPFeriasDrawer|setDrawerUserId/);
  assert.match(manager, /<ConcessivoCard[\s\S]*router\.push\(`\/dashboard\/dp\/ferias/);
  assert.match(manager, /<AquisitivoCard[\s\S]*router\.push\(`\/dashboard\/dp\/ferias/);
  assert.match(profilePage, /initialRegistrationOpen=\{action === 'register'\}/);
  assert.match(profile, /useState\(initialRegistrationOpen\)/);
  assert.match(profile, /DPVacationDecisionPanel/);
  assert.match(profile, /Revisar e decidir/);
  assert.match(profile, /record\.status === 'PENDING' \|\| record\.status === 'PLANNED'/);
  assert.match(profile, /onApprove=\{setDecisionVacation\}/);
});

test('perfil agrupa concessivo, resumo, ciclos e auditoria no mesmo bloco histórico', () => {
  assert.match(profile, /Ciclos e histórico/);
  assert.match(profile, /Consulte o prazo concessivo, os saldos, os lançamentos e a auditoria em um único bloco/);
  assert.match(profile, /DPVacationAuditTimeline/);
  assert.match(profile, /Histórico auditável/);
  assert.match(profile, /Histórico de Ciclos/);
  assert.doesNotMatch(workflow, /<details className="group/);
});

test('resumo separa estados dos ciclos das métricas do ciclo concessivo', () => {
  assert.match(profile, /Em aquisição/);
  assert.match(profile, /Em período concessivo/);
  assert.match(profile, /Encerrados/);
  assert.match(profile, /Vencidos/);
  assert.match(profile, /Férias do ciclo concessivo/);
  assert.match(profile, /Períodos lançados/);
  assert.match(profile, /Dias distribuídos/);
  assert.match(profile, /Saldo a programar/);
  assert.doesNotMatch(profile, /Total de registros/);
  assert.doesNotMatch(profile, /Dias registrados/);
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
  assert.match(manager, /\['PENDENTE', 'PARCIAL', 'VENCIDO'\]\.includes\(e\.health\.cycleStatus\)/);
  assert.match(manager, /e\.balance > 0/);
  assert.match(manager, /com saldo aberto/);
  assert.match(manager, /Prazo de aviso em risco/);
  assert.match(manager, /Em gozo neste mês/);
  assert.match(manager, /QueueRow/);
  assert.match(manager, /router\.push\(`\/dashboard\/dp\/ferias\/\$\{encodeURIComponent\(item\.user\.id\)\}`\)/);
  assert.match(manager, /DPVacationTimeline/);
  assert.match(timeline, /Aprovada/);
  assert.match(timeline, /Planejada/);
  assert.match(timeline, /Pendente/);
});

test('timeline encerra o conteúdo operacional depois do período aquisitivo', () => {
  const acquisitiveSection = manager.indexOf('{/* Período aquisitivo */}');
  const timelineSection = manager.indexOf('<DPVacationTimeline', acquisitiveSection);
  const monthModalSection = manager.indexOf('{/* Férias do mês modal */}', timelineSection);

  assert.ok(acquisitiveSection >= 0);
  assert.ok(timelineSection > acquisitiveSection);
  assert.ok(monthModalSection > timelineSection);
});

test('cadastro acontece na ficha individual e o drawer preserva edição e exclusão', () => {
  assert.match(profile, /DPVacationEditorPanel/);
  assert.match(profile, /<Sheet/);
  assert.match(drawer, /Abrir ficha/);
  assert.doesNotMatch(drawer, /Abrir perfil para registrar/);
  assert.match(drawer, /router\.push\(`\/dashboard\/dp\/ferias\/\$\{encodeURIComponent\(user\.id\)\}`\)/);
  assert.match(drawer, /Editar período lançado/);
  assert.match(drawer, /Excluir período lançado/);
  assert.match(drawer, /record\.workflow\?\.legalAnalysis\.noticeLeadDays/);
  assert.match(drawer, /label: 'No prazo'/);
  assert.match(drawer, /Aviso fora do prazo/);
  assert.match(drawer, /records\.filter\(r => r\.status !== 'REJECTED'\)/);
  assert.match(editor, /Salvar lançamento/);
  assert.match(editor, /Aviso de férias com menos de 30 dias/);
  assert.doesNotMatch(editor, /Início do gozo · antecedência do aviso/);
  assert.doesNotMatch(editor, /build\('short', 19\)/);
  assert.match(editor, /returnDate/);
  assert.match(editor, /status: record\?\.status \?\? 'PENDING'/);
});

test('ficha sem lançamento explica as três fases e antecipa as sete etapas', () => {
  assert.match(workflow, /Passo 1 de 3/);
  assert.match(workflow, /do ciclo \$\{cycle\.id\}/);
  assert.match(workflow, /Saldo do ciclo: \{balance\}d a agendar/);
  assert.match(workflow, /Concessivo até/);
  assert.match(workflow, /Avisar até/);
  assert.match(workflow, /Registrar o período/);
  assert.match(workflow, /Aprovar o agendamento/);
  assert.match(workflow, /As 7 etapas que vêm depois da aprovação/);
  assert.match(workflow, /STAGE_OWNER_LABEL\[stage\.owner\]/);
  assert.match(profile, /registrationCycle=\{defaultRegistrationCycle\}/);
  assert.match(workflow, /Nenhum ciclo disponível para registro/);
  assert.match(workflow, /O registro será liberado quando houver saldo em período concessivo/);
  assert.match(workflow, /if \(!cycle \|\| balance <= 0\)/);
});

test('as sete etapas mantêm ações do handoff e autorização coerente com o back-end', () => {
  assert.match(workflow, /canApprove && \['not_generated', 'failed', 'draft'\]\.includes\(notice\.status\)/);
  assert.match(workflow, /\['failed', 'draft'\]\.includes\(notice\.status\) \? 'Gerar novamente'/);
  assert.match(workflow, /canApprove && notice\.status === 'draft'/);
  assert.match(workflow, /canApprove && notice\.status === 'validated'/);
  assert.match(workflow, /noticeSigned && canApprove && \['ready_to_send', 'failed', 'correction_requested'\]/);
  assert.match(workflow, /disabled=\{!canApprove \|\| workflowBusy !== null \|\| !correctionReason\.trim\(\)\}/);
  assert.match(workflow, /canApprove && \['not_started', 'failed'\]\.includes\(workflow\.payment\.status\)/);
  assert.match(workflow, /canApprove && \['ready', 'failed'\]\.includes\(workflow\.receiptSignature\.status\)/);
  assert.match(workflow, /Reenviar convite/);
  assert.match(workflow, /\{ label: 'Aviso', done: noticeSigned \}/);
  assert.match(workflow, /\{ label: 'Pagamento', done: paymentPaid \}/);
  assert.match(workflow, /\{ label: 'Recibo', done: receiptSigned \}/);
  assert.match(workflow, /canApprove && workflow\.closure\.status === 'ready'/);
});

test('drawers de férias ocupam a viewport e mantêm conteúdo rolável entre cabeçalho e rodapé', () => {
  assert.match(profile, /height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh'/);
  assert.match(drawer, /height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh'/);
  assert.match(editor, /min-h-0 flex-1 space-y-4 overflow-y-auto/);
  assert.match(editor, /flex shrink-0 justify-end/);
});
