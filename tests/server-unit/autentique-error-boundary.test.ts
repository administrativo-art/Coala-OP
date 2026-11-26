import assert from 'node:assert/strict';
import test from 'node:test';
import { serverModuleLoader } from '../helpers/load-server-module';

test('provider response details never become messages and uncertain operations remain typed', async () => {
  const load = serverModuleLoader({});
  const api = load('src/lib/autentique.server.ts') as typeof import('../../src/lib/autentique.server');
  const originalFetch = globalThis.fetch, originalToken = process.env.AUTENTIQUE_API_TOKEN;
  process.env.AUTENTIQUE_API_TOKEN = 'synthetic-only';
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ message: 'private-provider-response@example.test' }] }), { status: 503 });
  try {
    await assert.rejects(api.getAutentiqueDocumentSignatures('synthetic-id'), (error: unknown) => error instanceof api.AutentiqueProviderError && !error.message.includes('private-provider-response'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.AUTENTIQUE_API_TOKEN; else process.env.AUTENTIQUE_API_TOKEN = originalToken;
  }
});

test('both provider read helpers reject a different document ID without exposing its signed URL', async () => {
  const api = serverModuleLoader({})('src/lib/autentique.server.ts') as typeof import('../../src/lib/autentique.server');
  const previousFetch = globalThis.fetch, previousToken = process.env.AUTENTIQUE_API_TOKEN;
  process.env.AUTENTIQUE_API_TOKEN = 'synthetic-only';
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { document: { id: 'different-document', signatures: [], signed_count: 1, signatures_count: 1, files: { signed: 'https://private.example.test/wrong.pdf' } } } }));
  try {
    for (const read of [api.getAutentiqueDocumentSignatures, api.getAutentiqueDocumentStatus]) await assert.rejects(read('expected-document'), error => error instanceof api.AutentiqueProviderError && !error.message.includes('private.example'));
  } finally { globalThis.fetch = previousFetch; if (previousToken === undefined) delete process.env.AUTENTIQUE_API_TOKEN; else process.env.AUTENTIQUE_API_TOKEN = previousToken; }
});
