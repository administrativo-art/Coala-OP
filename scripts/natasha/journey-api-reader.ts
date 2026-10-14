import { natashaJourneyDirectoryReportSchema } from '../../src/lib/natasha-journey-directory';
import { NatashaCollectError } from './coala-snapshot';

export function createNatashaJourneyApiReader(params: {
  token: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}) {
  if (!params.token) throw new NatashaCollectError('Sessão do Coala indisponível.');
  const baseUrl = (params.baseUrl ?? 'https://op.coalashakes.com').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(baseUrl)) throw new NatashaCollectError('Endereço do Coala inválido.');
  const fetcher = params.fetcher ?? fetch;

  return {
    async collect(period: string, unitIds: string[], employeeIds: string[]) {
      const url = new URL(`${baseUrl}/api/dp/natasha/journeys`);
      url.searchParams.set('period', period);
      for (const unitId of unitIds) url.searchParams.append('unit', unitId);
      for (const employeeId of employeeIds) url.searchParams.append('employee', employeeId);
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
        throw new NatashaCollectError('Falha ou tempo esgotado na resolução das jornadas.');
      }
      if (!response.ok || response.redirected) {
        throw new NatashaCollectError(`O Coala recusou a resolução das jornadas (HTTP ${response.status}); confira implantação, sessão e permissões.`);
      }
      const body = await response.json().catch(() => null);
      const parsed = natashaJourneyDirectoryReportSchema.safeParse(body);
      if (!parsed.success) throw new NatashaCollectError('O Coala retornou uma resolução de jornadas inválida.');
      return parsed.data;
    },
  };
}
