const required = ["PDVLEGAL_COD_EMPRESA", "PDVLEGAL_TOKEN", "PDVLEGAL_USERNAME", "PDVLEGAL_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} não configurado.`);
}

const codEmpresa = process.env.PDVLEGAL_COD_EMPRESA;
const apiToken = process.env.PDVLEGAL_TOKEN;
const params = new URLSearchParams({
  grant_type: "password",
  username: process.env.PDVLEGAL_USERNAME,
  password: process.env.PDVLEGAL_PASSWORD,
});
const authString = Buffer.from(`${codEmpresa}:${apiToken}`).toString("base64");
function responseArray(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "usuarios", "users", "items", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function safeEntry(entry) {
  const allowed = {};
  for (const [key, value] of Object.entries(entry || {})) {
    if (/senha|password|token|pin/i.test(key)) continue;
    if (/id|codigo|nome|email|login|usuario|ativo|status|filial|cpf/i.test(key)) allowed[key] = value;
  }
  return allowed;
}

const results = [];
for (const { baseUrl, userPath } of [
  { baseUrl: "https://api.tabletcloud.com.br", userPath: "/usuariopdv/get" },
  { baseUrl: "https://api.pdvlegal.com.br", userPath: "/v1/usuariopdv" },
]) {
  try {
    const authResponse = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authString}`,
        Token: apiToken,
      },
      body: params.toString(),
    });
    if (!authResponse.ok) {
      results.push({ baseUrl, authStatus: authResponse.status, status: null, total: 0, matches: [] });
      continue;
    }
    const authPayload = await authResponse.json();
    if (!authPayload?.access_token) throw new Error("Token PDV ausente.");
    const response = await fetch(`${baseUrl}${userPath}`, {
      headers: {
        Authorization: `Bearer ${authPayload.access_token}`,
        CodEmpresa: codEmpresa,
        Token: apiToken,
        Accept: "application/json",
      },
    });
    const bodyText = await response.text();
    let payload = null;
    try { payload = JSON.parse(bodyText); } catch {}
    const entries = responseArray(payload);
    const matches = entries.filter((entry) => {
      const searchable = JSON.stringify(safeEntry(entry)).toLowerCase();
      return searchable.includes("sara") || searchable.includes("ferreira") || searchable.includes("coelho");
    });
    results.push({
      baseUrl,
      userPath,
      status: response.status,
      payloadKeys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : [],
      total: entries.length,
      matches: matches.map(safeEntry),
      errorPreview: response.ok ? null : bodyText.slice(0, 180),
    });
  } catch (error) {
    results.push({ baseUrl, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ pdvUserLookup: results }, null, 2));
