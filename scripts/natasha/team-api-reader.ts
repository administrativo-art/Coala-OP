import { natashaTeamDirectoryReportSchema } from '../../src/lib/natasha-team-directory';
import { NatashaCollectError } from './coala-snapshot';

export function createNatashaTeamApiReader(params: {
  token: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}) {
  if (!params.token) throw new NatashaCollectError('Sessão do Coala indisponível.');
  const baseUrl = (params.baseUrl ?? 'https://op.coalashakes.com').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(baseUrl)) throw new NatashaCollectError('Endereço do Coala inválido.');
  const fetcher = params.fetcher ?? fetch;

  return {
    async collect(unitIds: string[]) {
      const url = new URL(`${baseUrl}/api/dp/natasha/team`);
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
        throw new NatashaCollectError('Falha ou tempo esgotado na leitura da equipe candidata.');
      }
      if (!response.ok || response.redirected) {
        throw new NatashaCollectError(`O Coala recusou a equipe candidata (HTTP ${response.status}); confira implantação, sessão e permissões.`);
      }
      const body = await response.json().catch(() => null);
      const parsed = natashaTeamDirectoryReportSchema.safeParse(body);
      if (!parsed.success) throw new NatashaCollectError('O Coala retornou uma equipe candidata inválida.');
      return parsed.data;
    },
  };
}
