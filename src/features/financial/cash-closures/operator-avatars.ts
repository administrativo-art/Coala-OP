type ClosureOperator = {
  id: string;
  name: string;
};

type UserAvatarCandidate = {
  username?: unknown;
  avatarUrl?: unknown;
  pdvOperatorIds?: unknown;
  registrationIdPdv?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function operatorIdForKiosk(value: unknown, kioskId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const operatorId = (value as Record<string, unknown>)[kioskId];
  return operatorId === null || operatorId === undefined ? "" : String(operatorId).trim();
}

export function resolveOperatorAvatarUrls(params: {
  kioskId: string;
  operators: ClosureOperator[];
  users: UserAvatarCandidate[];
}) {
  const avatars: Record<string, string> = {};
  const operatorsById = new Map(params.operators.map((operator) => [operator.id, operator]));
  const usersByNormalizedName = new Map<string, UserAvatarCandidate[]>();

  for (const user of params.users) {
    const avatarUrl = text(user.avatarUrl);
    if (!avatarUrl) continue;

    const linkedIds = [
      operatorIdForKiosk(user.pdvOperatorIds, params.kioskId),
      user.registrationIdPdv === null || user.registrationIdPdv === undefined
        ? ""
        : String(user.registrationIdPdv).trim(),
    ].filter(Boolean);

    for (const operatorId of linkedIds) {
      if (operatorsById.has(operatorId) && !avatars[operatorId]) avatars[operatorId] = avatarUrl;
    }

    const normalizedName = normalizeName(text(user.username));
    if (normalizedName) {
      usersByNormalizedName.set(normalizedName, [
        ...(usersByNormalizedName.get(normalizedName) ?? []),
        user,
      ]);
    }
  }

  for (const operator of params.operators) {
    if (avatars[operator.id]) continue;
    const matches = usersByNormalizedName.get(normalizeName(operator.name)) ?? [];
    if (matches.length === 1) avatars[operator.id] = text(matches[0].avatarUrl);
  }

  return avatars;
}
