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
const vacationPage = readFileSync('src/app/dashboard/dp/ferias/page.tsx', 'utf8');
const pageHeader = readFileSync('src/components/layout/page-header.tsx', 'utf8');
const globalStyles = readFileSync('src/app/globals.css', 'utf8');

test('panorama só pede agendamento para período concessivo com saldo aberto', () => {
  assert.match(manager, /cycle\.status !== 'GOZADO' && cycle\.status !== 'AQUISITIVO'/);
  assert.match(manager, /concessive\.status === 'PENDENTE' \|\| concessive\.status === 'PARCIAL'/);
  assert.match(manager, /concessive\.status === 'AGUARDANDO_APROVACAO'\) return \{ label: 'Aguardando aprovação'/);
  assert.match(manager, /concessive\.status === 'AGENDADO'/);
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
  assert.match(workflow, /Arquivos do contador/);
  assert.match(workflow, /Bloqueado até o pagamento/);
  assert.match(workflow, /Finalizar no RH/);
});

test('trilha mostra uma etapa por vez e mantém etapas concluídas navegáveis', () => {
  assert.match(workflow, /stageSelection\?\.recordId === record\.id/);
  assert.match(workflow, /vacationWorkflowDisplayStageId\(workflow\.currentStage\)/);
  assert.match(workflow, /aria-pressed=\{selected\}/);
  assert.match(workflow, /setStageSelection\(\{ recordId: record\.id, stage: meta\.id \}\)/);
  assert.match(workflow, /selectedStage === 'scheduling'/);
  assert.match(workflow, /selectedStage === 'notice'/);
  assert.match(workflow, /selectedStage === 'accountant'/);
  assert.match(workflow, /vacationWorkflowDisplayStageId\(workflow\.currentStage\)/);
  assert.doesNotMatch(workflow, /selectedStage === 'receipt_review'/);
  assert.match(workflow, /selectedStage === 'payment' \|\| selectedStage === 'receipt_signature' \|\| selectedStage === 'closure'/);
  assert.match(workflow, /Etapa concluída\. Os dados permanecem disponíveis para consulta/);
});

test('perfil não reabre trilha para um período legado que já terminou', () => {
  assert.match(profile, /shouldDisplayVacationWorkflow\(vacation, today\)/);
});

test('painel encaminha as filas para a ficha individual e mantém a decisão individual', () => {
  assert.match(manager, /const openPerson = \(userId: string\) => router\.push\(`\/dashboard\/dp\/ferias\/\$\{encodeURIComponent\(userId\)\}`\)/);
  assert.match(manager, /<PersonRow[^>]*onOpen=\{\(\) => openPerson\(person\.user\.id\)\}/);
  assert.doesNotMatch(manager, /\?action=register/);
  assert.doesNotMatch(manager, /DPFeriasDrawer|setDrawerUserId/);
  assert.doesNotMatch(manager, /Registrar férias/);
  assert.doesNotMatch(profilePage, /action === 'register'|initialRegistrationOpen/);
  assert.match(profile, /const \[scheduleOpen, setScheduleOpen\] = useState\(false\)/);
  assert.match(profile, /DPVacationDecisionPanel/);
  assert.match(profile, /Revisar e decidir/);
  assert.match(profile, /record\.status === 'PENDING' \|\| record\.status === 'PLANNED'/);
  assert.match(profile, /onApprove=\{setDecisionVacation\}/);
});

test('painel acompanha as trilhas ativas até a finalização e abre o período correto', () => {
  assert.match(manager, /label: 'Em andamento'/);
  assert.match(manager, /workflow\.status !== 'active'/);
  assert.match(manager, /Etapa \{stageIndex \+ 1\} de 6/);
  assert.match(manager, /Responsável: \{trail\.owner\}/);
  assert.match(manager, /\?vacation=\$\{encodeURIComponent\(trail\.record\.id\)\}/);
  assert.match(profilePage, /initialWorkflowVacationId/);
  assert.match(profile, /initialWorkflowVacationId \?\? null/);
});

test('página do colaborador separa período concessivo, aquisitivo, anteriores e auditoria', () => {
  assert.match(profile, /Período concessivo · as férias que precisam ser concedidas/);
  assert.match(profile, /Período aquisitivo · ganhando o próximo direito/);
  assert.match(profile, /Períodos anteriores/);
  assert.match(profile, /DPVacationAuditTimeline/);
  assert.match(profile, /Histórico auditável/);
  assert.doesNotMatch(workflow, /<details className="group/);
});

test('página do colaborador diz a situação de hoje, o próximo passo e desenha a regra do prazo', () => {
  assert.match(profile, /<PersonStatusBar today=\{nowText\}/);
  assert.match(profile, /label="próximo direito"/);
  assert.doesNotMatch(profile, /label="hoje"/);
  assert.match(profile, /<VacationRuleTimeline cycle=\{shownConcessive\}/);
  assert.match(profile, /gozados · \{Math\.max\(0, shownConcessive\.takenDays - enjoyedDays\)\} agendados/);
});

test('próximo passo usa a data-limite do aviso com 30 dias de antecedência', () => {
  assert.match(profile, /concessiveNoticeLimit/);
  assert.match(profile, /remainingDays \+ 29/);
  assert.match(profile, /Para dar o aviso a tempo, marque até/);
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

test('panorama traz indicadores, pendências do RH, filtro por unidade e calendário', () => {
  assert.match(manager, /Precisa de você/);
  assert.match(manager, /\['PENDENTE', 'PARCIAL', 'VENCIDO'\]\.includes\(cycle\.status\)/);
  assert.match(manager, /label="prazos em risco"/);
  assert.match(manager, /label="em gozo neste mês"/);
  assert.match(manager, /unitFilter === '__all__' \|\| user\.unitIds\?\.includes\(unitFilter\)/);
  assert.match(manager, /DPVacationTimeline/);
  assert.match(timeline, /Aprovada/);
  assert.match(timeline, /Planejada/);
  assert.match(timeline, /Pendente/);
});

test('férias usa o cabeçalho e a escala tipográfica canônicos', () => {
  assert.match(pageHeader, /data-ui="page-header"/);
  assert.match(pageHeader, /data-ui="page-title"/);
  assert.match(pageHeader, /text-2xl font-bold tracking-tight/);
  assert.match(vacationPage, /system-standard-page/);
  assert.match(manager, /<PageHero/);
  assert.match(globalStyles, /\.personal-section-density \.system-standard-page \[data-ui='page-title'\]/);
  assert.match(globalStyles, /font-size: 1\.5rem !important/);
});

test('linha do tempo das férias fica na aba Calendário, separada do panorama', () => {
  assert.match(manager, /view === 'calendar' \? \(\s*<DPVacationTimeline/);
  assert.match(manager, /label: 'Calendário'/);
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

test('ficha sem lançamento explica as três fases e antecipa as seis etapas visuais', () => {
  assert.match(workflow, /Passo 1 de 3/);
  assert.match(workflow, /do ciclo \$\{cycle\.id\}/);
  assert.match(workflow, /Saldo do ciclo: \{balance\}d a agendar/);
  assert.match(workflow, /Concessivo até/);
  assert.match(workflow, /Avisar até/);
  assert.match(workflow, /Registrar o período/);
  assert.match(workflow, /Aprovar o agendamento/);
  assert.match(workflow, /As 6 etapas que vêm depois da aprovação/);
  assert.match(workflow, /VACATION_WORKFLOW_DISPLAY_STAGE_META/);
  assert.match(workflow, /stage\.ownerLabel/);
  assert.match(profile, /registrationCycle=\{defaultRegistrationCycle\}/);
  assert.match(workflow, /Nenhum ciclo disponível para registro/);
  assert.match(workflow, /O registro será liberado quando houver saldo em período concessivo/);
  assert.match(workflow, /if \(!cycle \|\| balance <= 0\)/);
});

test('as seis etapas visuais mantêm ações do handoff e autorização coerente com o back-end', () => {
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

test('acompanhamento de assinatura destaca estado geral e quatro marcos operacionais', () => {
  assert.match(workflow, /function SignatureParticipantCard/);
  assert.match(workflow, /Convite enviado/);
  assert.match(workflow, /E-mail entregue/);
  assert.match(workflow, /Documento aberto/);
  assert.match(workflow, /Assinatura concluída/);
  assert.match(workflow, /Aguardando a assinatura do colaborador/);
  assert.match(workflow, /timeZone: 'America\/Belem'/);
  assert.match(workflow, /tone="violet"/);
  assert.match(workflow, /tone="sky"/);
});

test('drawers de férias ocupam a viewport e mantêm conteúdo rolável entre cabeçalho e rodapé', () => {
  assert.match(profile, /height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh'/);
  assert.match(drawer, /height: '100dvh', minHeight: '100dvh', maxHeight: '100dvh'/);
  assert.match(editor, /min-h-0 flex-1 space-y-4 overflow-y-auto/);
  assert.match(editor, /flex shrink-0 justify-end/);
});

test('painel de etapas não troca de parcela quando a trilha escolhida é concluída', () => {
  assert.match(profile, /const drawerWorkflowVacation = workflowVacations\.find\(vacation => vacation\.id === selectedWorkflowVacationId\);/);
  assert.match(profile, /open=\{workflowDrawerOpen && Boolean\(drawerWorkflowVacation\)\}/);
  assert.match(profile, /if \(selectedWorkflowVacationId\) setWorkflowDrawerOpen\(false\);/);
  assert.match(workflow, /workflow\.status === 'active' && workflow\.currentStage === 'scheduling' && canApprove/);
});

test('Panorama lista empregados CLT e aprendizes, não só quem é operacional', () => {
  assert.match(manager, /activeUsers\.filter\(hasVacationEntitlement\)/);
  assert.match(manager, /\['clt', 'apprenticeship'\]\.includes\(user\.employmentRelationshipType\)/);
  assert.doesNotMatch(manager, /activeUsers\.filter\(user => user\.operacional === true\)/);
});
