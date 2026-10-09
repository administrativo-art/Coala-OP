"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";

import { createDefaultManagementLayout } from "./default-layout";
import type { DashboardLayoutsPayload, ManagementDashboardLayout } from "./types";

async function request<T>(firebaseUser: FirebaseUser, method: string, body?: unknown): Promise<T> {
  const token = await firebaseUser.getIdToken();
  const response = await fetch("/api/dashboard/layouts", {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.error ?? "Não foi possível atualizar o painel.");
  return payload as T;
}
export function useManagementDashboardLayouts(firebaseUser: FirebaseUser | null, userId: string, userName: string) {
  const fallback = useMemo(() => createDefaultManagementLayout(userId || "local", userName || "Usuário"), [userId, userName]);
  const [payload, setPayload] = useState<DashboardLayoutsPayload>({ layouts: [fallback], activeLayoutId: fallback.id, canManageTemplates: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!firebaseUser) { setLoading(false); return; }
    setLoading(true);
    try { setPayload(await request<DashboardLayoutsPayload>(firebaseUser, "GET")); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar seus painéis."); }
    finally { setLoading(false); }
  }, [firebaseUser]);

  useEffect(() => { void load(); }, [load]);

  const activeLayout = payload.layouts.find((layout) => layout.id === payload.activeLayoutId) ?? payload.layouts[0] ?? fallback;

  const save = useCallback(async (layout: ManagementDashboardLayout) => {
    if (!firebaseUser) throw new Error("Autenticação necessária.");
    setSaving(true);
    try {
      const saved = await request<ManagementDashboardLayout>(firebaseUser, "PUT", {
        id: layout.id === "personal" ? undefined : layout.id,
        name: layout.name,
        description: layout.description,
        visibility: layout.visibility,
        targetProfileIds: layout.targetProfileIds,
        lockedWidgetIds: layout.lockedWidgetIds,
        widgets: layout.widgets,
        filters: layout.filters,
        expectedRevision: layout.id === "personal" ? undefined : layout.revision,
      });
      setPayload((current) => ({ ...current, activeLayoutId: saved.id, layouts: [saved, ...current.layouts.filter((item) => item.id !== saved.id && item.id !== layout.id)] }));
      setError(null);
      return saved;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível salvar o painel.";
      setError(message);
      throw cause;
    } finally { setSaving(false); }
  }, [firebaseUser]);

  const activate = useCallback(async (layoutId: string) => {
    if (!firebaseUser) return;
    await request(firebaseUser, "PATCH", { layoutId });
    setPayload((current) => ({ ...current, activeLayoutId: layoutId }));
  }, [firebaseUser]);

  const remove = useCallback(async (layoutId: string) => {
    if (!firebaseUser) return;
    await request(firebaseUser, "DELETE", { layoutId });
    await load();
  }, [firebaseUser, load]);

  return { ...payload, activeLayout, loading, saving, error, reload: load, save, activate, remove };
}
