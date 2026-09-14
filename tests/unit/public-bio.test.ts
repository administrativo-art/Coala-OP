import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { bioPageSchema, bioProductSlugs, defaultBioPage, defaultMomentProducts, isSafeBioUrl, publicBioProjection, uploadedBioProductImageId, validateBioForPublish } from "../../src/lib/public-bio";

test("a página pública aceita apenas destinos HTTPS externos", () => {
  assert.equal(isSafeBioUrl("https://wa.me/5598999999999"), true);
  assert.equal(isSafeBioUrl("https://www.instagram.com/coalashakes/"), true);
  for (const value of [
    "http://example.com/menu",
    "javascript:alert(1)",
    "https://op.coalashakes.com/dashboard",
    "https://op.coalashakes.com./dashboard",
    "https://sub.op.coalashakes.com/",
    "https://user:password@example.com/",
    "https://localhost:3000/",
    "https://192.168.1.1/",
    "https://[::1]/",
    "https://example.com/api/users",
  ]) {
    assert.equal(isSafeBioUrl(value), false, value);
  }
});

test("rascunho sem destino não pode ser publicado", () => {
  const empty = { ...defaultBioPage, links: defaultBioPage.links.map((link) => ({ ...link, enabled: false })) };
  assert.ok(validateBioForPublish(empty));
  assert.equal(publicBioProjection(empty), null);
});

test("projeção pública omite links desativados e campos não previstos", () => {
  const value = {
    ...defaultBioPage,
    secret: "não pode aparecer",
    links: [
      { ...defaultBioPage.links[1], url: "https://wa.me/5598999999999" },
      { ...defaultBioPage.links[0], enabled: false },
    ],
  };
  assert.equal(validateBioForPublish(value), null);
  assert.deepEqual(publicBioProjection(value), {
    title: value.title,
    description: value.description,
    menuImages: [],
    promotionImages: [],
    momentProducts: defaultMomentProducts,
    links: [{ ...value.links[0] }],
  });
  assert.equal(bioPageSchema.safeParse({ ...value, links: [value.links[0], value.links[0]] }).success, false);
});

test("oito posições de produtos aceitam foto e nome, preservando a ordem publicada", () => {
  assert.equal(defaultMomentProducts.length, 8);
  assert.ok(existsSync(resolve("public/images/coala-bio-logo-final.svg")));
  for (const slug of bioProductSlugs) assert.ok(existsSync(resolve("public/images/bio-products", `${slug}.webp`)), slug);
  assert.equal(bioPageSchema.safeParse({ ...defaultBioPage, momentProducts: defaultMomentProducts.slice(0, 7) }).success, false);
  assert.equal(bioPageSchema.safeParse({ ...defaultBioPage, momentProducts: [...defaultMomentProducts, defaultMomentProducts[0]] }).success, false);
  const rearranged = [defaultMomentProducts[7], ...defaultMomentProducts.slice(0, 7)];
  assert.deepEqual(publicBioProjection({ ...defaultBioPage, momentProducts: rearranged })?.momentProducts, rearranged);

  const empty = { ...defaultBioPage, momentProducts: [...rearranged.slice(0, 7), { name: "", image: "" }] };
  assert.equal(validateBioForPublish(empty), null);
  assert.deepEqual(publicBioProjection(empty)?.momentProducts, rearranged.slice(0, 7));
  assert.match(validateBioForPublish({ ...empty, momentProducts: [...rearranged.slice(0, 7), { name: "Sem foto", image: "" }] }) ?? "", /foto e o nome/);
});

test("foto enviada só é publicada com identificador válido e nunca expõe caminhos internos", () => {
  const id = "f096a022-46c3-48bf-88ee-e6c7a903cd80";
  assert.equal(uploadedBioProductImageId(`uploaded:${id}`), id);
  assert.equal(uploadedBioProductImageId("uploaded:../secret"), null);
  assert.equal(bioPageSchema.safeParse({ ...defaultBioPage, momentProducts: [{ name: "Teste", image: `uploaded:${id}` }, ...defaultMomentProducts.slice(1)] }).success, true);
  for (const image of ["builtin:../../admin", "uploaded:../secret", "https://op.coalashakes.com/api/private", "javascript:alert(1)"]) {
    assert.equal(bioPageSchema.safeParse({ ...defaultBioPage, momentProducts: [{ name: "Teste", image }, ...defaultMomentProducts.slice(1)] }).success, false, image);
  }
});

test("galerias só abrem com imagens válidas e a ordem publicada é preservada", () => {
  const first = { id: "f096a022-46c3-48bf-88ee-e6c7a903cd80", alt: "Cardápio página 1" };
  const second = { id: "25ffdb78-d6c9-4357-a98b-6f50c89a50e4", alt: "Cardápio página 2" };
  const page = { ...defaultBioPage, links: defaultBioPage.links.map((link) => link.kind === "menu" ? { ...link, enabled: true } : link) };
  assert.match(validateBioForPublish(page) ?? "", /Cardápio|cardápio/);
  const withImages = { ...page, menuImages: [second, first] };
  assert.equal(validateBioForPublish(withImages), null);
  assert.deepEqual(publicBioProjection(withImages)?.menuImages, [second, first]);
  assert.equal(bioPageSchema.safeParse({ ...withImages, menuImages: [{ id: "../secret", alt: "Inválido" }] }).success, false);
});
