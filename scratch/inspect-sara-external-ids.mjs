const EMAIL = "sara17ferreira2004@gmail.com";
const NAME_PARTS = ["sara", "ferreira", "coelho"];

function safeUser(user) {
  return {
    id: user?.id ?? null,
    firstName: user?.first_name ?? null,
    lastName: user?.last_name ?? null,
    email: user?.email ?? null,
    externalId: user?.external_id ?? null,
    workContracts: Array.isArray(user?.work_contracts)
      ? user.work_contracts.map((contract) => ({ id: contract.id, startAt: contract.start_at, endAt: contract.end_at }))
      : [],
  };
}

const bizneoToken = process.env.BIZNEO_TOKEN;
if (!bizneoToken) throw new Error("BIZNEO_TOKEN não configurado.");

const matches = [];
let page = 1;
while (true) {
  const response = await fetch(`https://coala.bizneohr.com/api/v1/users?token=${encodeURIComponent(bizneoToken)}&page_size=100&page=${page}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Bizneo retornou HTTP ${response.status}.`);
  const payload = await response.json();
  const users = Array.isArray(payload?.users) ? payload.users : Array.isArray(payload) ? payload : [];
  for (const user of users) {
    const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim().toLowerCase();
    const email = String(user?.email || "").trim().toLowerCase();
    if (email === EMAIL || NAME_PARTS.every((part) => fullName.includes(part))) matches.push(safeUser(user));
  }
  const totalPages = Number(payload?.pagination?.total_pages || page);
  if (!users.length || page >= totalPages) break;
  page += 1;
}

console.log(JSON.stringify({ bizneoMatches: matches }, null, 2));
