import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatOfficialClock, officialClockOffsetMs } from '../../src/features/dp/rep-p/official-clock';

describe('Relógio do coletor REP-P', () => {
  it('shows hours, minutes and seconds in the establishment time zone, corrected by the measured offset', () => {
    const offset = officialClockOffsetMs('2026-10-18T11:15:42.000Z', Date.parse('2026-10-18T11:15:30.000Z'));
    assert.equal(offset, 12_000);
    assert.equal(formatOfficialClock(Date.parse('2026-10-18T11:15:30.000Z') + offset, 'America/Fortaleza'), '08:15:42');
    assert.equal(formatOfficialClock(Date.parse('2026-10-19T02:59:59.000Z'), 'America/Fortaleza'), '23:59:59');
  });

  it('is required on every collector screen and blocks the button without official time', async () => {
    const { readFileSync } = await import('node:fs');
    const hook = readFileSync('src/features/dp/rep-p/use-rep-p-marking.ts', 'utf8');
    // Sem hora oficial nada é enviado, nem o reenvio de uma tentativa pendente.
    assert.match(hook, /canRecord: Boolean\(effectiveUnitId\) && options\?\.markingEnabled === true && options\?\.officialClock\?\.available === true/);
    // A faixa e a janela de confirmação compartilhada são o coletor: relógio visível e botões presos a canRecord.
    const strip = readFileSync('src/features/dp/rep-p/record-strip.tsx', 'utf8');
    assert.match(strip, /<OfficialClockDisplay clock=\{unitClock\}/);
    assert.match(strip, /disabled=\{!canRecord\}/);
    assert.match(strip, /disabled=\{!canRecord \|\| !purpose\}/);
    // A janela não fecha com a batida em voo, senão a confirmação do servidor se perde e a pessoa bate de novo.
    assert.match(strip, /if \(!next && recording\) return;/);
    assert.match(strip, /Baixar comprovante/);
    // A barra superior e o painel do colaborador usam a mesma confirmação, não uma cópia.
    for (const file of ['src/features/dp/rep-p/quick-marking-button.tsx', 'src/components/collaborator-dashboard-panel.tsx']) {
      assert.match(readFileSync(file, 'utf8'), /<RecordDialog /, file);
    }
  });
});

describe('Caminho para o Registro de ponto', () => {
  it('has a fixed sidebar entry between Perfil and Integração, independent from the marking options', async () => {
    const { readFileSync } = await import('node:fs');
    const sidebar = readFileSync('src/components/sidebar.tsx', 'utf8');
    const profile = sidebar.indexOf('label: "Perfil do colaborador"');
    const entry = sidebar.indexOf('{ label: "Registro de ponto", href: "/dashboard/collaborator/time-recording", icon: Clock3, show: canViewCollaboratorPanel }');
    const integration = sidebar.indexOf('{ label: "Integração", href: "/dashboard/hr/recruitment/integration"');
    assert.ok(profile >= 0 && entry > profile && integration > entry);
    // Sem coleta ligada a tela abre, avisa e não deixa registrar.
    const strip = readFileSync('src/features/dp/rep-p/record-strip.tsx', 'utf8');
    assert.match(strip, /ainda não liberado/);
  });
});
