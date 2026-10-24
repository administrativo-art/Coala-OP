import type { NextRequest } from "next/server";

import {
  DEVELOPER_VIEW_AS_COOKIE,
  DEVELOPER_VIEW_AS_HEADER,
  type DeveloperViewAsUser,
} from "./developer-view-as";

const FIREBASE_DOCUMENT_ID = /^[^/\u0000-\u001f\u007f]{1,128}$/;

function cleanTargetId(value: string | undefined) {
  const targetId = value?.trim() ?? "";
  return FIREBASE_DOCUMENT_ID.test(targetId) ? targetId : null;
}

export function requestedDeveloperViewAsUserId(request: NextRequest) {
  return cleanTargetId(
    request.headers.get(DEVELOPER_VIEW_AS_HEADER) ??
      request.cookies.get(DEVELOPER_VIEW_AS_COOKIE)?.value,
  );
}

export function developerViewAsUser(value: { id: string } & Record<string, unknown>): DeveloperViewAsUser {
  return {
    id: value.id,
    username: typeof value.username === "string" && value.username.trim()
      ? value.username.trim()
      : "Usuário sem nome",
    email: typeof value.email === "string" ? value.email.trim().toLowerCase() : "",
    ...(typeof value.avatarUrl === "string" && value.avatarUrl.trim()
      ? { avatarUrl: value.avatarUrl.trim() }
      : {}),
    ...(typeof value.jobRoleName === "string" && value.jobRoleName.trim()
      ? { jobRoleName: value.jobRoleName.trim() }
      : {}),
    profileId: typeof value.profileId === "string" ? value.profileId : "",
  };
}
