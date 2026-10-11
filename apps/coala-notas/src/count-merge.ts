/**
 * Qual rascunho vale ao reabrir uma contagem: o do Coala One ou o que ficou só neste aparelho
 * (sem internet na hora de sair). Vale o mais recente, para um celular que ficou para trás não
 * sobrescrever o que a pessoa continuou em outro aparelho.
 */
export type StoredDrafts<Draft> = { savedAt: number; drafts: Record<string, Draft> };

export function chooseCountDrafts<Draft>(input: {
  server: Record<string, Draft>;
  /** Última gravação da contagem no Coala One; ausente quando ela nunca foi salva lá. */
  serverUpdatedAt: string | null | undefined;
  local: StoredDrafts<Draft> | null;
  /** Lotes que existem na contagem; rascunho de lote desconhecido é ignorado. */
  knownLotIds: Iterable<string>;
}): { drafts: Record<string, Draft>; source: "server" | "local"; discardedLocal: boolean } {
  const known = new Set(input.knownLotIds);
  const local = input.local ? Object.fromEntries(Object.entries(input.local.drafts).filter(([lotId]) => known.has(lotId))) : {};
  if (!input.local || !Object.keys(local).length) return { drafts: input.server, source: "server", discardedLocal: false };
  const serverTime = input.serverUpdatedAt ? Date.parse(input.serverUpdatedAt) : Number.NaN;
  // Sem data no servidor, ninguém salvou lá depois de abrir: o aparelho é a versão mais nova.
  if (Number.isNaN(serverTime) || input.local.savedAt > serverTime) return { drafts: { ...input.server, ...local }, source: "local", discardedLocal: false };
  return { drafts: input.server, source: "server", discardedLocal: true };
}
