import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("não executa soffice local quando o conversor remoto não está configurado", async () => {
  const previousUrl = process.env.DOCX_TO_PDF_URL;
  const previousAudience = process.env.DOCX_TO_PDF_AUDIENCE;
  const previousToken = process.env.DOCX_TO_PDF_ID_TOKEN;
  const previousSoffice = process.env.SOFFICE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), "coala-no-soffice-"));
  const marker = path.join(directory, "invocado");
  const fakeSoffice = path.join(directory, "soffice");

  try {
    await writeFile(
      fakeSoffice,
      `#!/bin/sh\nprintf invoked > \"${marker}\"\nexit 1\n`,
    );
    await chmod(fakeSoffice, 0o755);
    delete process.env.DOCX_TO_PDF_URL;
    delete process.env.DOCX_TO_PDF_AUDIENCE;
    delete process.env.DOCX_TO_PDF_ID_TOKEN;
    process.env.SOFFICE_PATH = fakeSoffice;

    const { convertDocxToPdf } = await import(
      "../../../src/features/hr/documents/pdf-converter.server"
    );
    const result = await convertDocxToPdf(
      Buffer.from(`arquivo-sem-conversor-${Date.now()}`),
    );

    assert.equal(result, null);
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    if (previousUrl === undefined) delete process.env.DOCX_TO_PDF_URL;
    else process.env.DOCX_TO_PDF_URL = previousUrl;
    if (previousAudience === undefined) delete process.env.DOCX_TO_PDF_AUDIENCE;
    else process.env.DOCX_TO_PDF_AUDIENCE = previousAudience;
    if (previousToken === undefined) delete process.env.DOCX_TO_PDF_ID_TOKEN;
    else process.env.DOCX_TO_PDF_ID_TOKEN = previousToken;
    if (previousSoffice === undefined) delete process.env.SOFFICE_PATH;
    else process.env.SOFFICE_PATH = previousSoffice;
    await rm(directory, { recursive: true, force: true });
  }
});
