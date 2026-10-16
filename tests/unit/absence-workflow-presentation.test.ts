import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AbsenceWorkflowSection } from '../../src/features/dp/absences/requests/workflow-panel';

test('central própria e fila de análise distinguem o escopo no estado vazio', () => {
  const mine = renderToStaticMarkup(createElement(AbsenceWorkflowSection, { firebaseUser: null, scope: 'mine' }));
  const review = renderToStaticMarkup(createElement(AbsenceWorkflowSection, { firebaseUser: null, scope: 'review' }));
  assert.match(mine, /Meus pedidos de ausência/);
  assert.match(mine, /Você ainda não tem pedidos de ausência/);
  assert.match(review, /Aguardando minha análise/);
  assert.match(review, /Nenhuma ausência atribuída/);
});

test('painel apresenta SLA de 24 horas e limita os avisos ao sino', () => {
  const source = readFileSync(new URL('../../src/features/dp/absences/requests/workflow-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /Prazo por etapa humana/);
  assert.match(source, /horas corridas/);
  assert.match(source, /não há aprovação automática/);
  assert.match(source, /somente no sino do Coala/);
  assert.match(source, /Não são enviados por e-mail nem por push/);
  assert.match(source, /selected\.reviewSla \? <PanelField label="Prazo da análise"/);
  assert.match(source, /selected\.preflight\.approvalSlaHours \? <PanelField/);
  assert.doesNotMatch(source, /acceptedByProvider|aceita pelo provedor/);
});
