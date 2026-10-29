import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profile = readFileSync('src/app/dashboard/dp/collaborators/[userId]/page.tsx', 'utf8');
const card = readFileSync('src/features/dp/time-bank/time-bank-card.tsx', 'utf8');
const page = readFileSync('src/features/dp/rep-p/my-time-recording-page.tsx', 'utf8');

test('barra do perfil expõe registro e banco somente a titulares ou leitores autorizados', () => {
  assert.match(profile, /const canReadTimeRecording = Boolean\(/);
  assert.match(profile, /permissions\.dp\?\.timeRecording\?\.view/);
  assert.match(profile, /permissions\.dp\?\.timeClosure\?\.close/);
  assert.match(profile, /permissions\.dp\?\.timeClosure\?\.reopen/);
  assert.match(profile, /<HeaderIconLink[^>]*label="Registro de ponto"/);
  assert.match(profile, /<HeaderIconLink[^>]*label="Banco de horas"/);
  assert.match(profile, /\?view=time-bank/);
  assert.match(profile, /bg-ds-ink\/95/);
});

test('banco abre uma visão detalhada separada sem liberar batida pelo DP', () => {
  assert.match(page, /initialView === "time-bank"/);
  assert.match(page, /Resumo e extrato detalhado/);
  assert.match(page, /<TimeBankCard[^>]*detailed/);
  assert.match(page, /O DP pode consultar e analisar o extrato, mas não registra batidas/);
  // O cartão "Banco de horas" das consultas leva à visão detalhada.
  assert.match(page, /view: "time-bank", title: "Banco de horas"/);
  assert.match(page, /`\$\{baseHref\}\?view=\$\{view\}`/);
  assert.match(card, /Ver banco de horas detalhado/);
  assert.match(card, /detailed && lines\.length/);
});

test('ações manuais do banco exigem a capacidade de gestão na interface', () => {
  assert.match(card, /employeeUid && canManage && statement\.residual/);
  assert.match(card, /employeeUid && canManage \? <div/);
});
