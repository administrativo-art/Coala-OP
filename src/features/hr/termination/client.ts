import type { User as FirebaseUser } from "firebase/auth";

export async function terminationFetch<T>(user: FirebaseUser, path: string, init?: RequestInit): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Falha ao carregar desligamentos.");
  return body as T;
}
