const documentId = process.argv[2]?.trim();
if (!documentId) throw new Error("Informe o ID do documento.");

let token = "";
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (!token) throw new Error("A chave do Autentique não foi recebida.");

const response = await fetch("https://api.autentique.com.br/v2/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query: `query InspectDocument($id: UUID!) {
      document(id: $id) {
        id name
        signatures {
          public_id name email
          action { name }
          user { id name email }
          email_events { sent opened delivered refused reason }
        }
      }
    }`,
    variables: { id: documentId },
  }),
  signal: AbortSignal.timeout(30_000),
});
const payload = await response.json().catch(() => null);
if (!response.ok || payload?.errors?.length || !payload?.data?.document) {
  const details = payload?.errors?.map((error) => error.message).join("; ");
  throw new Error(details || `Autentique retornou HTTP ${response.status}.`);
}

console.log(
  JSON.stringify({
    documentId: payload.data.document.id,
    documentName: payload.data.document.name,
    signatures: payload.data.document.signatures?.map((signature) => ({
      publicId: signature.public_id,
      requestedEmail: signature.email,
      registeredUserEmail: signature.user?.email ?? null,
      action: signature.action?.name ?? null,
      emailEvents: signature.email_events ?? null,
    })),
  })
);
