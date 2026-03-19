import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createServer } from "http";
import { z } from "zod";

// Inicializa Firebase Admin
if (!getApps().length) {
  initializeApp();
}
// Conecta ao banco de dados específico "coala" conforme firebase.json
const db = getFirestore("coala");

const mcpServer = new McpServer({
  name: "coala-erp-estoque",
  version: "1.0.0"
});

// 🟢 LEITURA: Listar coleções
mcpServer.tool("listar_colecoes", {}, async () => {
  const collections = await db.listCollections();
  const names = collections.map(c => c.id);
  return { content: [{ type: "text", text: JSON.stringify(names, null, 2) }] };
});

// 🟢 LEITURA: Buscar documentos
mcpServer.tool(
  "buscar_documentos",
  { colecao: z.string(), limite: z.number().optional() },
  async ({ colecao, limite = 20 }) => {
    const snapshot = await db.collection(colecao).limit(limite).get();
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
  }
);

// 🟢 LEITURA: Filtrar documentos
mcpServer.tool(
  "filtrar_documentos",
  {
    colecao: z.string(),
    campo: z.string(),
    operador: z.string(),
    valor: z.union([z.string(), z.number(), z.boolean()])
  },
  async ({ colecao, campo, operador, valor }) => {
    const snapshot = await db.collection(colecao).where(campo, operador, valor).get();
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    return { content: [{ type: "text", text: JSON.stringify(docs, null, 2) }] };
  }
);

// 🟢 LEITURA: Resumo do estoque
mcpServer.tool(
  "resumo_estoque",
  { colecao: z.string() },
  async ({ colecao }) => {
    const snapshot = await db.collection(colecao).get();
    const total = snapshot.size;
    const docs = snapshot.docs.map(d => d.data());
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total_documentos: total, amostra: docs.slice(0, 5) }, null, 2)
      }]
    };
  }
);

// Servidor HTTP
const httpServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", modo: "somente-leitura", projeto: "coala-erp-estoque" }));
    return;
  }

  if (req.method === "POST" && req.url === "/mcp") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => transport.close());
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, JSON.parse(body));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => {
  console.log(`✅ Servidor MCP Coala ERP Estoque [SOMENTE LEITURA] rodando na porta ${PORT}`);
});