import assert from 'node:assert/strict';
import test from 'node:test';
import { uberRecognitionView } from '../../src/features/financial/lib/uber-recognition';

test('expõe o solicitante e os dados da viagem conciliada', () => {
  assert.deepEqual(uberRecognitionView({
    uberCandidate: true,
    uberRecognitionStatus: 'matched',
    uberRequesterName: 'Ana Souza',
    uberService: 'UberX',
    uberRequestDateLocal: '2026-09-09',
    uberTripAmount: 25,
    uberTripCurrency: 'BRL',
    uberTripId: 'trip-123',
  }), {
    status: 'matched',
    title: 'Solicitada por Ana Souza',
    detail: 'UberX · 09/09/2026 · R$ 25,00 · viagem trip-123',
  });
});

test('diferencia espera de correspondência ambígua', () => {
  assert.equal(uberRecognitionView({ uberCandidate: true, uberRecognitionStatus: 'waiting' })?.status, 'waiting');
  assert.equal(uberRecognitionView({ uberCandidate: true, uberRecognitionStatus: 'ambiguous' })?.status, 'ambiguous');
  assert.equal(uberRecognitionView({ uberCandidate: false, uberRecognitionStatus: 'matched' }), null);
});
