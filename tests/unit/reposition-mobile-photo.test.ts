import assert from "node:assert/strict";
import test from "node:test";
import { mobileRepositionPhotoQuerySchema, mobileRepositionPhotoUrl, readMobileRepositionPhoto } from "../../src/features/reposition/mobile-receipt";
import type { RepositionActivity } from "../../src/types";

const photo = "data:image/png;base64,iVBORw0KGgo=";
const activity = { id: "a", status: "Aguardando recebimento", kioskDestinationId: "unit", items: [{ baseProductId: "base", suggestedLots: [{ lotId: "lot", productId: "product" }] }] } as unknown as RepositionActivity;
const input = { activityId: "a", baseProductId: "base", lotId: "lot" };

test("embedded receipt photos use an activity-scoped authenticated route without exposing the product id", () => {
  const url = mobileRepositionPhotoUrl("a", input, photo);
  assert.equal(url, "/api/stock/mobile-reposition/photo?activityId=a&baseProductId=base&lotId=lot");
  assert.equal(mobileRepositionPhotoUrl("a", input, "https://example.test/photo.png"), "https://example.test/photo.png");
  assert.equal(mobileRepositionPhotoUrl("a", input, "javascript:bad"), null);
});
test("receipt photo query rejects extra fields, empty ids and traversal", () => {
  assert.equal(mobileRepositionPhotoQuerySchema.safeParse(input).success, true);
  for (const query of [{ ...input, productId: "other" }, { ...input, lotId: "" }, { ...input, activityId: "../a" }]) assert.equal(mobileRepositionPhotoQuerySchema.safeParse(query).success, false);
});
test("no receipt permission means no activity or product reads", async () => {
  const result = await readMobileRepositionPhoto(input, { authorized: false, loadActivity: async () => { assert.fail("activity read"); }, canAccessDestination: () => true, loadImage: async () => { assert.fail("product read"); } });
  assert.deepEqual(result, { ok: false, reason: "forbidden" });
});
test("other destination, absent lot and finalized receipt never read a product", async () => {
  for (const [record, access, query] of [[activity, false, input], [activity, true, { ...input, lotId: "foreign" }], [{ ...activity, status: "Concluído" }, true, input]] as const) {
    const result = await readMobileRepositionPhoto(query, { authorized: true, loadActivity: async () => record as RepositionActivity, canAccessDestination: () => access, loadImage: async () => { assert.fail("product read"); } });
    assert.equal(result.ok, false);
  }
});
test("authorized receipt resolves the dispatched product and returns its embedded image", async () => {
  const result = await readMobileRepositionPhoto(input, { authorized: true, loadActivity: async () => activity, canAccessDestination: (unit) => unit === "unit", loadImage: async (id) => { assert.equal(id, "product"); return photo; } });
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.unitId, "unit"); assert.equal(result.photo.contentType, "image/png"); }
});
