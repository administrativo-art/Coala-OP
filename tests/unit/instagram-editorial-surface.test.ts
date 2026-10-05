import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/instagram-programacao/page.tsx", "utf8");
const scheduleRoute = readFileSync("src/app/api/integrations/instagram/schedule/route.ts", "utf8");
const postsRoute = readFileSync("src/app/api/integrations/instagram/posts/route.ts", "utf8");
const publisher = readFileSync("functions/src/instagram-publishing-job.ts", "utf8");
const indexes = JSON.parse(readFileSync("firestore.signage.indexes.json", "utf8")) as {
  indexes: Array<{ collectionGroup?: string; fields?: Array<{ fieldPath?: string }> }>;
};

test("a interface cria no cadastro editorial e não usa o agendamento direto", () => {
  assert.match(page, /\/api\/integrations\/instagram\/posts/);
  assert.match(page, /EditorialPostsView/);
  assert.doesNotMatch(page, /CreateScheduleDialog/);
  assert.match(scheduleRoute, /INSTAGRAM_EDITORIAL_POST_REQUIRED/);
  assert.doesNotMatch(scheduleRoute, /createInstagramScheduleFromForm/);
});

test("a sincronização editorial é incremental e paginada", () => {
  assert.match(postsRoute, /updatedAfter/);
  assert.match(postsRoute, /startAfter/);
  assert.match(postsRoute, /nextCursor/);
  assert.match(postsRoute, /\.limit\(limit\)/);
});

test("o mesmo job entrega lembretes manuais sem chamar a Meta", () => {
  assert.match(publisher, /deliverManualReminders/);
  assert.match(publisher, /manualReminder/);
  assert.match(publisher, /await deliverManualReminders\(\);\s*const token/);
  assert.ok(indexes.indexes.some((index) =>
    index.collectionGroup === "instagramManualPublicationReminders"
    && index.fields?.some((field) => field.fieldPath === "wakeAt"),
  ));
});
