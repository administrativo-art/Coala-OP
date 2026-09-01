import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLT_TERMINATION_REASONS,
  PJ_TERMINATION_REASONS,
  employmentRelationshipLabel,
  isEmploymentRelationshipType,
  resolveEmploymentRelationshipType,
  terminationReasonsForRelationship,
} from '../../../src/lib/hr/employment-relationship';

test('aceita somente os três tipos de vínculo desta entrega', () => {
  assert.equal(isEmploymentRelationshipType('clt'), true);
  assert.equal(isEmploymentRelationshipType('pj'), true);
  assert.equal(isEmploymentRelationshipType('internship'), true);
  assert.equal(isEmploymentRelationshipType('temporary'), false);
  assert.equal(isEmploymentRelationshipType(null), false);
});

test('recupera o vínculo de cadastros legados pelo tipo canônico da pessoa', () => {
  assert.equal(resolveEmploymentRelationshipType(undefined, 'employee'), 'clt');
  assert.equal(resolveEmploymentRelationshipType(undefined, 'pj'), 'pj');
  assert.equal(resolveEmploymentRelationshipType(undefined, 'internship'), 'internship');
  assert.equal(resolveEmploymentRelationshipType('pj', 'employee'), 'pj');
  assert.equal(resolveEmploymentRelationshipType(undefined, 'director'), undefined);
});

test('mantém as causas trabalhistas vinculadas exclusivamente ao CLT', () => {
  assert.deepEqual(terminationReasonsForRelationship('clt'), CLT_TERMINATION_REASONS);
  assert.equal(terminationReasonsForRelationship('clt').includes('Dispensa por justa causa'), true);
  assert.equal(terminationReasonsForRelationship('pj').some((reason) => reason === 'Dispensa por justa causa'), false);
});

test('oferece motivos contratuais próprios para PJ e bloqueia estágio nesta entrega', () => {
  assert.deepEqual(terminationReasonsForRelationship('pj'), PJ_TERMINATION_REASONS);
  assert.equal(terminationReasonsForRelationship('pj').includes('Término do prazo contratual'), true);
  assert.deepEqual(terminationReasonsForRelationship('internship'), []);
  assert.deepEqual(terminationReasonsForRelationship(undefined), []);
  assert.equal(employmentRelationshipLabel(undefined), 'Vínculo não definido');
});
