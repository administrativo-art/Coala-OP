export type AuditLogInput = {
  module: string;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogEntry = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  username: string | null;
  module: string;
  action: string;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  timestamp: string | null;
  ttl: string | null;
};

