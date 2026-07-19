import PizZip from "pizzip";

const email = process.argv[2]?.trim();
const holderName = process.argv[3]?.trim() || email;
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error("Informe um e-mail válido para o teste sandbox.");
}

let token = "";
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (!token) throw new Error("A chave do Autentique não foi recebida.");

const zip = new PizZip();
zip.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  </Types>`
);
zip.folder("_rels").file(
  ".rels",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  </Relationships>`
);
zip.folder("word").file(
  "document.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
      <w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Coala One — teste de integração</w:t></w:r></w:p>
      <w:p><w:r><w:t>Este documento foi criado exclusivamente para validar a integração sandbox com o Autentique.</w:t></w:r></w:p>
      <w:p><w:r><w:t>Não possui validade jurídica ou efeito contratual.</w:t></w:r></w:p>
      <w:p><w:r><w:t>Data do teste: ${new Date().toISOString()}</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
    </w:body>
  </w:document>`
);
const documentBuffer = zip.generate({ type: "nodebuffer" });
const documentName = `COALA SHAKES - Teste de integração - ${holderName}`;

const mutation = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
  createDocument(sandbox: true, document: $document, signers: $signers, file: $file) {
    id name created_at signatures { public_id email action { name } }
  }
}`;
const form = new FormData();
form.append(
  "operations",
  JSON.stringify({
    query: mutation,
    variables: {
      document: {
        name: documentName,
        message: "Teste técnico da integração Coala One. Este documento não possui validade.",
      },
      signers: [{ email, action: "SIGN" }],
      file: null,
    },
  })
);
form.append("map", JSON.stringify({ file: ["variables.file"] }));
form.append(
  "file",
  new Blob([documentBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  "coala-one-teste-sandbox.docx"
);

const response = await fetch("https://api.autentique.com.br/v2/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
  signal: AbortSignal.timeout(30_000),
});
const payload = await response.json().catch(() => null);
if (!response.ok || payload?.errors?.length || !payload?.data?.createDocument) {
  const details = payload?.errors?.map((error) => error.message).join("; ");
  throw new Error(details || `Autentique retornou HTTP ${response.status}.`);
}

const document = payload.data.createDocument;
console.log(
  JSON.stringify({
    success: true,
    sandbox: true,
    documentId: document.id,
    documentName: document.name,
    createdAt: document.created_at,
    recipient: document.signatures?.[0]?.email ?? email,
  })
);
