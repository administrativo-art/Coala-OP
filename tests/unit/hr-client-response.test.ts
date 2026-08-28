import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readHrJsonResponse } from '../../src/features/hr/lib/client-response';

describe('respostas JSON do cliente de RH', () => {
  test('lê uma resposta JSON válida', async () => {
    const payload = await readHrJsonResponse<{ ok: boolean }>(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      'Falha ao carregar.',
    );

    assert.deepEqual(payload, { ok: true });
  });

  test('transforma texto de proxy em erro legível', async () => {
    await assert.rejects(
      () => readHrJsonResponse(
        new Response('upstream connect error or disconnect/reset before headers', { status: 503 }),
        'Falha ao carregar integrações.',
      ),
      /Falha ao carregar integrações\. \(HTTP 503\)/,
    );
  });

  test('preserva a mensagem segura do envelope central de erro', async () => {
    await assert.rejects(
      () => readHrJsonResponse(
        new Response(JSON.stringify({
          error: {
            code: 'ACCOUNTANT_REGISTRY_FILE_INVALID',
            message: 'Envie a Ficha de Registro em PDF.',
            requestId: 'request-1',
          },
        }), { status: 400 }),
        'Falha ao anexar.',
      ),
      /Envie a Ficha de Registro em PDF\./,
    );
  });

  test('não expõe erro de JSON quando uma resposta 200 é inválida', async () => {
    await assert.rejects(
      () => readHrJsonResponse(new Response('upstream response inválida', { status: 200 }), 'Falha ao carregar.'),
      /Falha ao carregar\. Resposta inválida do servidor\./,
    );
  });
});
