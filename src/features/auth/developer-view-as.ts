export const DEVELOPER_VIEW_AS_EMAIL = "administrativo@cialashakes.com";
export const DEVELOPER_VIEW_AS_HEADER = "x-coala-view-as";
export const DEVELOPER_VIEW_AS_COOKIE = "coala_dev_view_as";
export const DEVELOPER_VIEW_AS_MAX_USERS = 250;

export type DeveloperViewAsUser = {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
  jobRoleName?: string;
  profileId: string;
};

export type DeveloperViewAsDirectory = {
  enabled: true;
  targetUserId: string | null;
  targetUser: DeveloperViewAsUser | null;
  users: DeveloperViewAsUser[];
};

export function isDeveloperViewAsEmail(value: unknown) {
  return typeof value === "string" && value.trim().toLowerCase() === DEVELOPER_VIEW_AS_EMAIL;
}

export function isDeveloperViewAsReadMethod(method: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method.trim().toUpperCase());
}
