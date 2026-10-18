import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createObservatorioNacionalNtpClock,
  OBSERVATORIO_NACIONAL_NTP_SERVERS,
  repPNtpClockForTest,
} from '../../src/features/dp/rep-p/hlb-ntp-clock.server';

const NTP_EPOCH_SECONDS = 2_208_988_800;

function writeTimestamp(packet: Buffer, offset: number, unixMs: number) {
  const ntp = unixMs / 1_000 + NTP_EPOCH_SECONDS;
  packet.writeUInt32BE(Math.floor(ntp) >>> 0, offset);
  packet.writeUInt32BE(Math.floor((ntp - Math.floor(ntp)) * 0x1_0000_0000) >>> 0, offset + 4);
}

function responseFor(request: Buffer, receivedByServerMs: number, transmittedByServerMs: number) {
  const response = Buffer.alloc(48);
  response[0] = 0x24; // leap=0, version=4, mode=4 (server)
  response[1] = 2;
  request.copy(response, 24, 40, 48);
  writeTimestamp(response, 32, receivedByServerMs);
  writeTimestamp(response, 40, transmittedByServerMs);
  return response;
}

describe('REP-P — NTP público do Observatório Nacional', () => {
  it('aceita resposta NTP vinculada à requisição e calcula offset e latência', () => {
    const sentAtMs = Date.parse('2026-10-18T12:00:00.000Z');
    const receivedAtMs = sentAtMs + 55;
    const request = repPNtpClockForTest.buildRequest(sentAtMs);
    const sample = repPNtpClockForTest.parseResponse({
      request,
      response: responseFor(request, sentAtMs + 75, sentAtMs + 80),
      server: OBSERVATORIO_NACIONAL_NTP_SERVERS[0], sentAtMs, receivedAtMs,
    });
    assert.ok(Math.abs(sample.offsetMs - 50) < 0.001);
    assert.ok(Math.abs(sample.roundTripMs - 50) < 0.001);
    assert.equal(sample.stratum, 2);
  });

  it('recusa resposta sem eco exato do timestamp de origem', () => {
    const sentAtMs = Date.parse('2026-10-18T12:00:00.000Z');
    const request = repPNtpClockForTest.buildRequest(sentAtMs);
    const response = responseFor(request, sentAtMs + 20, sentAtMs + 21);
    response[31] ^= 1;
    assert.throws(() => repPNtpClockForTest.parseResponse({ request, response,
      server: OBSERVATORIO_NACIONAL_NTP_SERVERS[0], sentAtMs, receivedAtMs: sentAtMs + 40 }), /NTP_ORIGIN_MISMATCH/);
  });

  it('exige ao menos dois servidores concordantes e ignora uma resposta divergente', async () => {
    let nowMs = Date.parse('2026-10-18T12:00:00.000Z');
    let queries = 0;
    const offsets = new Map<string, number>([
      [OBSERVATORIO_NACIONAL_NTP_SERVERS[0], 100],
      [OBSERVATORIO_NACIONAL_NTP_SERVERS[1], 110],
      [OBSERVATORIO_NACIONAL_NTP_SERVERS[2], 95],
      [OBSERVATORIO_NACIONAL_NTP_SERVERS[3], 5_000],
    ]);
    const clock = createObservatorioNacionalNtpClock({ now: () => nowMs, query: async (server) => {
      queries += 1;
      return { server, offsetMs: offsets.get(server)!, roundTripMs: 30, stratum: 2, verifiedAtMs: nowMs };
    } });

    const first = await clock.read();
    assert.equal(first.observedOffsetMs, 100);
    assert.equal(first.instant.getTime(), nowMs + 100);
    assert.match(first.source, /quorum=3/);
    assert.equal(first.attestationMode, 'fresh');
    assert.match(first.attestationId, /^[a-f0-9]{64}$/);
    assert.equal(first.quorum, 3);
    assert.deepEqual(first.observations.map((item) => item.status).sort(),
      ['accepted', 'accepted', 'accepted', 'discarded']);
    assert.doesNotMatch(first.source, new RegExp(OBSERVATORIO_NACIONAL_NTP_SERVERS[3].replaceAll('.', '\\.')));
    assert.equal(queries, 4);

    nowMs += 30_000;
    const cached = await clock.read();
    assert.equal(cached.instant.getTime(), nowMs + 100);
    assert.equal(cached.attestationMode, 'cached');
    assert.equal(queries, 4);
  });

  it('reutiliza atestação recente em falha transitória e bloqueia depois de cinco minutos', async () => {
    let nowMs = Date.parse('2026-10-18T12:00:00.000Z');
    let available = true;
    const clock = createObservatorioNacionalNtpClock({ now: () => nowMs, query: async (server) => {
      if (!available) throw new Error('offline');
      return { server, offsetMs: 10, roundTripMs: 20, stratum: 2, verifiedAtMs: nowMs };
    } });
    await clock.read();
    available = false;
    nowMs += 61_000;
    const fallback = await clock.read();
    assert.equal(fallback.observedOffsetMs, 10);
    assert.equal(fallback.attestationMode, 'fallback');
    await assert.rejects(clock.read({ requireFresh: true }), { code: 'REP_P_TIME_UNAVAILABLE' });
    nowMs += 5 * 60_000;
    await assert.rejects(clock.read(), { code: 'REP_P_TIME_UNAVAILABLE' });
  });

  it('falha fechado quando só um servidor oficial responde', async () => {
    const nowMs = Date.parse('2026-10-18T12:00:00.000Z');
    const clock = createObservatorioNacionalNtpClock({ now: () => nowMs, query: async (server) => {
      if (server !== OBSERVATORIO_NACIONAL_NTP_SERVERS[0]) throw new Error('offline');
      return { server, offsetMs: 0, roundTripMs: 20, stratum: 2, verifiedAtMs: nowMs };
    } });
    await assert.rejects(clock.read(), { code: 'REP_P_TIME_UNAVAILABLE' });
  });

  it('falha fechado quando quatro respostas formam dois quóruns 2×2 incompatíveis', () => {
    const nowMs = Date.parse('2026-10-18T12:00:00.000Z');
    const samples = OBSERVATORIO_NACIONAL_NTP_SERVERS.map((server, index) => ({ server,
      offsetMs: index < 2 ? index * 10 : 5_000 + (index - 2) * 10,
      roundTripMs: 20, stratum: 1, verifiedAtMs: nowMs }));
    assert.throws(() => repPNtpClockForTest.selectAttestation(samples), { code: 'REP_P_TIME_UNAVAILABLE' });
  });

  it('aceita dois concordantes com duas falhas, maioria 3×1 e quatro concordantes', async () => {
    const nowMs = Date.parse('2026-10-18T12:00:00.000Z');
    const scenarios = [
      [10, 12, null, null],
      [10, 12, 14, 5_000],
      [10, 12, 14, 16],
    ];
    for (const offsets of scenarios) {
      const clock = createObservatorioNacionalNtpClock({ now: () => nowMs, query: async (server) => {
        const index = OBSERVATORIO_NACIONAL_NTP_SERVERS.indexOf(server as never);
        const offsetMs = offsets[index];
        if (offsetMs === null) throw new Error('offline');
        return { server, offsetMs, roundTripMs: 20, stratum: 1, verifiedAtMs: nowMs };
      } });
      const reading = await clock.read({ requireFresh: true });
      assert.equal(reading.attestationMode, 'fresh');
      assert.equal(reading.quorum, offsets.filter((offset) => offset !== null && offset < 1_000).length);
      assert.equal(reading.observations.length, 4);
    }
  });
});
