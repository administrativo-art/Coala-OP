import { natashaAvailabilityReportSchema } from '../../src/lib/natasha-availability';
import { NatashaCollectError } from './coala-snapshot';

export function createNatashaAvailabilityApiReader(params: {
  token: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}) {
  if (!params.token) throw new NatashaCollectError('Sessão do Coala indisponível.');
  const baseUrl = (params.baseUrl ?? 'https://op.coalashakes.com').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(baseUrl)) throw new NatashaCollectError('Endereço do Coala inválido.');
  const fetcher = params.fetcher ?? fetch;

  return {
    async collect(period: string, unitIds: string[]) {
      const url = new URL(`${baseUrl}/api/dp/natasha/availability`);
      url.searchParams.set('period', period);
      for (const unitId of unitIds) url.searchParams.append('unit', unitId);
      let response: Response;
      try {
        response = await fetcher(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${params.token}` },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new NatashaCollectError('Falha ou tempo esgotado na leitura das férias da equipe candidata.');
      }
      if (!response.ok || response.redirected) {
        throw new NatashaCollectError(`O Coala recusou as férias da equipe candidata (HTTP ${response.status}); confira implantação, sessão e permissões.`);
      }
      const body = await response.json().catch(() => null);
      const parsed = natashaAvailabilityReportSchema.safeParse(body);
      if (!parsed.success) throw new NatashaCollectError('O Coala retornou uma disponibilidade inválida.');
      return parsed.data;
    },
  };
}
