import assert from "node:assert/strict";
import test from "node:test";

import {
  instagramMediaFolderCreateSchema,
  instagramMediaFolderUpdateSchema,
  instagramMediaMoveSchema,
  type InstagramMediaFolder,
} from "../../src/features/instagram-scheduler/contracts";
import {
  INSTAGRAM_MEDIA_FOLDER_MAX_COUNT,
  INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH,
  buildFolderTree,
  checkCreateFolder,
  checkRenameOrMoveFolder,
  folderDepth,
  folderPath,
  folderSubtreeHeight,
  uniqueFolderName,
} from "../../src/features/instagram-scheduler/media-folders";
import {
  legacyFolderId,
  legacyFolderName,
  planMediaFolderMigration,
} from "../../src/features/instagram-scheduler/media-folders-migration";

const f = (id: string, name: string, parentId: string | null = null): InstagramMediaFolder => ({ id, name, parentId });
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

test("profundidade e altura do galho de pastas", () => {
  const tree = [f("a", "A"), f("b", "B", "a"), f("c", "C", "b")];
  assert.equal(folderDepth(tree, null), 0);
  assert.equal(folderDepth(tree, "c"), 3);
  assert.equal(folderDepth(tree, "inexistente"), null);
  assert.equal(folderSubtreeHeight(tree, "a"), 3);
  assert.equal(folderSubtreeHeight(tree, "c"), 1);
  assert.equal(folderDepth([f("x", "X", "y"), f("y", "Y", "x")], "x"), null);
});

test("criação respeita pai, nome repetido (sem diferenciar caixa/acento composto) e profundidade", () => {
  const tree = [f("a", "Campanhas")];
  assert.equal(checkCreateFolder(tree, { name: "campanhas", parentId: null }), "DUPLICATE_NAME");
  assert.equal(checkCreateFolder(tree, { name: "Campanhas", parentId: "a" }), null);
  assert.equal(checkCreateFolder(tree, { name: "X", parentId: "nao-existe" }), "PARENT_NOT_FOUND");

  const chain: InstagramMediaFolder[] = [];
  for (let level = 1; level <= INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH; level += 1) {
    chain.push(f(`n${level}`, `N${level}`, level === 1 ? null : `n${level - 1}`));
  }
  assert.equal(checkCreateFolder(chain, { name: "Fundo", parentId: `n${INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH}` }), "MAX_DEPTH");
  assert.equal(checkCreateFolder(chain, { name: "Ok", parentId: `n${INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH - 1}` }), null);

  const many = Array.from({ length: INSTAGRAM_MEDIA_FOLDER_MAX_COUNT }, (_, i) => f(`p${i}`, `P${i}`));
  assert.equal(checkCreateFolder(many, { name: "Extra", parentId: null }), "MAX_COUNT");
});

test("mover pasta impede ciclo, estouro de profundidade e nome repetido no destino", () => {
  const tree = [f("a", "A"), f("b", "B", "a"), f("c", "C", "b"), f("d", "D"), f("b2", "B", "d")];
  assert.equal(checkRenameOrMoveFolder(tree, { id: "a", name: "A", parentId: "a" }), "MOVE_INTO_ITSELF");
  assert.equal(checkRenameOrMoveFolder(tree, { id: "a", name: "A", parentId: "c" }), "MOVE_INTO_ITSELF");
  assert.equal(checkRenameOrMoveFolder(tree, { id: "b", name: "B", parentId: "d" }), "DUPLICATE_NAME");
  assert.equal(checkRenameOrMoveFolder(tree, { id: "b", name: "B2", parentId: "d" }), null);
  assert.equal(checkRenameOrMoveFolder(tree, { id: "c", name: "C", parentId: null }), null);
  assert.equal(checkRenameOrMoveFolder(tree, { id: "zzz", name: "Z", parentId: null }), "FOLDER_NOT_FOUND");
  // renomear a si mesma para o mesmo nome não é duplicidade
  assert.equal(checkRenameOrMoveFolder(tree, { id: "a", name: "a", parentId: null }), null);

  const deep: InstagramMediaFolder[] = [];
  for (let level = 1; level <= INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH; level += 1) {
    deep.push(f(`n${level}`, `N${level}`, level === 1 ? null : `n${level - 1}`));
  }
  deep.push(f("g", "Galho"), f("g2", "Filha", "g"));
  assert.equal(checkRenameOrMoveFolder(deep, { id: "g", name: "Galho", parentId: `n${INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH - 1}` }), "MAX_DEPTH");
});

test("nome livre entre irmãs ao subir conteúdo de uma pasta excluída", () => {
  const siblings = [f("1", "Fotos"), f("2", "Fotos (2)")];
  assert.equal(uniqueFolderName(siblings, null, "Fotos"), "Fotos (3)");
  assert.equal(uniqueFolderName(siblings, null, "Vídeos"), "Vídeos");
  assert.equal(uniqueFolderName(siblings, null, "fotos", "1"), "fotos");
  assert.equal(uniqueFolderName(siblings, null, "fotos", "9"), "fotos (3)");
  assert.ok(uniqueFolderName([f("1", "x".repeat(80))], null, "x".repeat(80)).length <= 80);
});

test("árvore ordenada, breadcrumb e órfãs na raiz", () => {
  const folders = [f("b", "banana", "a"), f("a", "Ágata"), f("o", "Órfã", "sumiu"), f("c", "Cacau")];
  const tree = buildFolderTree(folders);
  assert.deepEqual(tree.map((node) => node.name), ["Ágata", "Cacau", "Órfã"]);
  assert.equal(tree[0]!.children[0]!.depth, 2);
  assert.deepEqual(folderPath(folders, "b").map((folder) => folder.name), ["Ágata", "banana"]);
  assert.deepEqual(folderPath(folders, null), []);
  assert.equal(buildFolderTree([f("x", "X", "y"), f("y", "Y", "x")]).length, 0);
});

test("schemas de pasta e de movimentação são estritos", () => {
  assert.equal(instagramMediaFolderCreateSchema.safeParse({ name: "Stories", parentId: null }).success, true);
  assert.equal(instagramMediaFolderCreateSchema.safeParse({ name: "a/b", parentId: null }).success, false);
  assert.equal(instagramMediaFolderCreateSchema.safeParse({ name: "x", parentId: "nao-uuid" }).success, false);
  assert.equal(instagramMediaFolderCreateSchema.safeParse({ name: "x", parentId: null, extra: 1 }).success, false);
  assert.equal(instagramMediaFolderUpdateSchema.safeParse({}).success, false);
  assert.equal(instagramMediaFolderUpdateSchema.safeParse({ parentId: null }).success, true);
  assert.equal(instagramMediaFolderUpdateSchema.safeParse({ name: "Novo" }).success, true);
  assert.equal(instagramMediaMoveSchema.safeParse({ ids: [UUID_A], folderId: null }).success, true);
  assert.equal(instagramMediaMoveSchema.safeParse({ ids: [UUID_A, UUID_A], folderId: UUID_B }).success, false);
  assert.equal(instagramMediaMoveSchema.safeParse({ ids: [], folderId: null }).success, false);
  assert.equal(
    instagramMediaMoveSchema.safeParse({ ids: Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), folderId: null }).success,
    false,
  );
});

test("migração cria uma pasta por nome legado, é determinística e idempotente", () => {
  assert.equal(legacyFolderName(undefined), "Uploads");
  assert.equal(legacyFolderName("  Camp/anha\\X  "), "Camp anha X");
  assert.equal(legacyFolderId("w1", "Uploads"), legacyFolderId("w1", "uploads"));
  assert.notEqual(legacyFolderId("w1", "Uploads"), legacyFolderId("w2", "Uploads"));
  assert.match(legacyFolderId("w1", "Uploads"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const plan = planMediaFolderMigration([
    { id: "m1", workspaceId: "w1", folder: "Uploads", hasFolderId: false },
    { id: "m2", workspaceId: "w1", folder: "uploads", hasFolderId: false },
    { id: "m3", workspaceId: "w1", folder: "Verão", hasFolderId: false },
    { id: "m4", workspaceId: "w1", folder: "Uploads", hasFolderId: true },
    { id: "m5", workspaceId: "w2", folder: undefined, hasFolderId: false },
  ]);
  assert.equal(plan.alreadyMigrated, 1);
  assert.equal(plan.folders.length, 3);
  assert.equal(plan.assignments.length, 4);
  assert.equal(plan.assignments[0]!.folderId, plan.assignments[1]!.folderId);
  assert.equal(planMediaFolderMigration([{ id: "m4", workspaceId: "w1", folder: "x", hasFolderId: true }]).assignments.length, 0);
});
