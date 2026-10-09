import assert from "node:assert/strict";
import test from "node:test";

import { engagementRate, findPostInsight, objectiveMetric } from "../../src/features/instagram-posts/result-model";

const item = {
  id: "m1", format: "Feed" as const, caption: "", previewUrl: null, permalink: null, publishedAt: "2026-10-01T12:00:00Z",
  views: 900, reach: 400, totalInteractions: 40, likes: 30, comments: 6, shares: 2, saves: 2, replies: 3, bioLinkClicks: 5, storyLinkClicks: null,
};
const post = (ids: { id: string | null; ids: string[] } | null) => ({
  planning: { designRationale: "", formatRationale: "", objective: null, callToAction: "", plannedAt: null, updatedAt: null },
  publicationResult: ids && { instagramMediaId: ids.id, instagramMediaIds: ids.ids, permalink: null, publishedAt: null, status: "published", safeError: null },
});

test("casa o post com a mídia pelo identificador publicado", () => {
  assert.equal(findPostInsight(post({ id: "m1", ids: [] }), [item]), item);
  assert.equal(findPostInsight(post({ id: null, ids: ["x", "m1"] }), [item]), item);
  assert.equal(findPostInsight(post({ id: "zzz", ids: [] }), [item]), null);
  assert.equal(findPostInsight(post(null), [item]), null);
});

test("escolhe a métrica do objetivo planejado", () => {
  assert.deepEqual(objectiveMetric("awareness", item), { label: "Alcance", value: 400 });
  assert.deepEqual(objectiveMetric(null, item), { label: "Alcance", value: 400 });
  assert.equal(objectiveMetric("engagement", item).value, 40);
  assert.equal(objectiveMetric("sales", item).value, 5);
  assert.equal(objectiveMetric("relationship", item).value, 9);
  assert.equal(objectiveMetric("institutional", item).value, 900);
  assert.equal(objectiveMetric("sales", { ...item, bioLinkClicks: null, storyLinkClicks: null }).value, null);
});

test("calcula a taxa de interação sobre o alcance", () => {
  assert.equal(engagementRate(item), 10);
  assert.equal(engagementRate({ reach: 0, totalInteractions: 3 }), null);
  assert.equal(engagementRate({ reach: 10, totalInteractions: null }), null);
});
