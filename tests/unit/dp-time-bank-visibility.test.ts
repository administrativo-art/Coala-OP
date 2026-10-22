import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profile = readFileSync('src/app/dashboard/dp/collaborators/[userId]/page.tsx', 'utf8');
const card = readFileSync('src/features/dp/time-bank/time-bank-card.tsx', 'utf8');

test('barra do perfil expõe registro e banco somente a titulares ou leitores autorizados', () => {
  assert.match(profile, /const canReadTimeRecording = Boolean\(/);
  assert.match(profile, /permissions\.dp\?\.timeRecording\?\.view/);
  assert.match(profile, /permissions\.dp\?\.timeClosure\?\.close/);
  assert.match(profile, /permissions\.dp\?\.timeClosure\?\.reopen/);
  assert.match(profile, />\s*Registro de ponto\s*</);
  assert.match(profile, />\s*Banco de horas\s*</);
  assert.match(profile, /#banco-de-horas/);
});

test('ações manuais do banco exigem a capacidade de gestão na interface', () => {
  assert.match(card, /employeeUid && canManage && statement\.residual/);
  assert.match(card, /employeeUid && canManage \? <div/);
});
