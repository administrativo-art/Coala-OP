/** Desempenho do post publicado na etapa Resultado (testado em tests/unit/instagram-post-result.test.ts). */

import type { InstagramInsightContentItem } from "@/features/instagram-scheduler/contracts";

import type { InstagramEditorialPost, InstagramPostObjective } from "./contracts";

type ResultPost = Pick<InstagramEditorialPost, "publicationResult" | "planning">;

/** Mídia dos relatórios que corresponde ao post: casa pelo identificador da mídia publicada no Instagram. */
export function findPostInsight(post: ResultPost, items: InstagramInsightContentItem[]): InstagramInsightContentItem | null {
  const ids = new Set([post.publicationResult?.instagramMediaId, ...(post.publicationResult?.instagramMediaIds ?? [])].filter((id): id is string => Boolean(id)));
  if (ids.size === 0) return null;
  return items.find((item) => ids.has(item.id)) ?? null;
}

export type ObjectiveMetric = { label: string; value: number | null };

/** A métrica que melhor mede o objetivo planejado; sem objetivo, o alcance. */
export function objectiveMetric(objective: InstagramPostObjective | null, item: InstagramInsightContentItem): ObjectiveMetric {
  const sum = (...values: Array<number | null>) => (values.every((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0));
  switch (objective) {
    case "engagement": return { label: "Interações", value: item.totalInteractions };
    case "sales": return { label: "Cliques no link", value: sum(item.bioLinkClicks, item.storyLinkClicks) };
    case "relationship": return { label: "Conversas (comentários e respostas)", value: sum(item.comments, item.replies) };
    case "institutional": return { label: "Visualizações", value: item.views };
    case "awareness":
    default: return { label: "Alcance", value: item.reach };
  }
}

/** Taxa de interação sobre o alcance, em %, com uma casa; nula quando não há alcance. */
export function engagementRate(item: Pick<InstagramInsightContentItem, "reach" | "totalInteractions">): number | null {
  if (!item.reach || item.totalInteractions === null) return null;
  return Math.round((item.totalInteractions / item.reach) * 1000) / 10;
}
