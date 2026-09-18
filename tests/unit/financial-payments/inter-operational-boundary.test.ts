import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function filesBelow(relativeDirectory: string): Promise<string[]> {
  const directory = path.join(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? filesBelow(relativePath) : [relativePath];
  }));
  return files.flat();
}

test("credenciais bancárias permanecem vinculadas ao runtime do App Hosting", async () => {
  const appHosting = await source("apphosting.yaml");
  for (const secret of [
    "INTER_CLIENT_ID",
    "INTER_CLIENT_SECRET",
    "INTER_CERTIFICATE_BASE64",
    "INTER_PRIVATE_KEY_BASE64",
  ]) {
    assert.match(
      appHosting,
      new RegExp(`variable: ${secret}\\s+secret: ${secret}`),
      `${secret} deve ser uma referência do Secret Manager, nunca um valor no arquivo`,
    );
  }
});

test("scripts do repositório não extraem credenciais bancárias do Secret Manager", async () => {
  const scriptFiles = (await filesBelow("scripts"))
    .filter((file) => /\.(?:cjs|js|mjs|mts|ts)$/.test(file));
  for (const file of scriptFiles) {
    const content = await source(file);
    assert.doesNotMatch(
      content,
      /(?:gcloud\s+secrets\s+versions\s+access|accessSecretVersion)[\s\S]{0,300}INTER_(?:CLIENT|CERTIFICATE|PRIVATE_KEY)/i,
      `${file} não pode extrair material bancário para o processo local`,
    );
  }
});

test("regra operacional proíbe erro HTTP bancário bruto e credenciais locais", async () => {
  const instructions = await source("AGENTS.md");
  assert.match(instructions, /É proibido acessar ou exportar o valor das credenciais bancárias/);
  assert.match(instructions, /Nunca registre, propague ou serialize o erro bruto de clientes HTTP bancários/);
});
