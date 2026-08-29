import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { dbAdmin } from "@/lib/firebase-admin";
import { resolveOperatorAvatarUrls } from "./operator-avatars";

const OPERATOR_QUERY_CHUNK_SIZE = 30;
const MAX_CLOSURE_OPERATORS = 50;
const MAX_USERS_PER_QUERY = 100;

type ClosureOperator = { id: string; name: string };

function chunks<T>(values: T[]) {
  return Array.from({ length: Math.ceil(values.length / OPERATOR_QUERY_CHUNK_SIZE) }, (_, index) => (
    values.slice(index * OPERATOR_QUERY_CHUNK_SIZE, (index + 1) * OPERATOR_QUERY_CHUNK_SIZE)
  ));
}

async function boundedUsers(query: FirebaseFirestore.Query) {
  const snapshot = await query
    .select("username", "avatarUrl", "pdvOperatorIds", "registrationIdPdv")
    .limit(MAX_USERS_PER_QUERY + 1)
    .get();
  if (snapshot.size > MAX_USERS_PER_QUERY) {
    throw new Error("A consulta de avatares encontrou usuários demais para um mesmo identificador.");
  }
  return snapshot.docs;
}

export async function loadCashClosureOperatorAvatarUrls(input: {
  kioskId: string;
  operators: ClosureOperator[];
}) {
  const operators = Array.from(new Map(input.operators.map((operator) => [operator.id, operator])).values());
  if (operators.length > MAX_CLOSURE_OPERATORS) {
    throw new Error("O fechamento ultrapassa o limite operacional de operadores.");
  }
  const operatorIds = operators.map((operator) => operator.id).filter(Boolean);
  if (operatorIds.length === 0) return {};

  const linkedQueries = chunks(operatorIds).flatMap((ids) => {
    const legacyIds = Array.from(new Set<unknown>(ids.flatMap((id) => {
      const numeric = Number(id);
      return Number.isSafeInteger(numeric) && String(numeric) === id ? [id, numeric] : [id];
    })));
    return [
      dbAdmin.collection("users").where(new FieldPath("pdvOperatorIds", input.kioskId), "in", ids),
      ...chunks(legacyIds).map((values) => dbAdmin.collection("users").where("registrationIdPdv", "in", values)),
    ];
  });
  const linkedDocuments = (await Promise.all(linkedQueries.map(boundedUsers))).flat();
  const usersById = new Map(linkedDocuments.map((document) => [document.id, document.data()]));
  const linkedAvatars = resolveOperatorAvatarUrls({
    kioskId: input.kioskId,
    operators,
    users: [...usersById.values()],
  });
  const missingNames = Array.from(new Set(operators
    .filter((operator) => !linkedAvatars[operator.id])
    .map((operator) => operator.name)
    .filter(Boolean)));
  const nameDocuments = (await Promise.all(chunks(missingNames).map((names) => boundedUsers(
    dbAdmin.collection("users").where("username", "in", names),
  )))).flat();
  for (const document of nameDocuments) usersById.set(document.id, document.data());

  return resolveOperatorAvatarUrls({
    kioskId: input.kioskId,
    operators,
    users: [...usersById.values()],
  });
}
