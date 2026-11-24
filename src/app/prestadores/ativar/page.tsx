"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalRequest } from "@/features/service-portal/client";

export default function ActivateProviderPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""); }, []);
  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError("As senhas precisam ser iguais."); return; }
    setBusy(true);
    setError("");
    try {
      await portalRequest("/api/service-portal/activate", { token, password });
      setPassword(""); setConfirmation(""); setDone(true);
      window.history.replaceState(null, "", "/prestadores/ativar");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível ativar o acesso."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-ds-page px-5 py-12 font-ds text-ds-ink">
    <div className="mx-auto max-w-md space-y-6">
      <header><p className="text-sm text-ds-ink-muted">Coala · Prestadores de serviço</p><h1 className="mt-2 text-3xl font-bold">Ativar seu acesso</h1></header>
      {done ? <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-6">
        <p>Sua senha foi definida. Você já pode entrar no Portal do Contador.</p><Link className="underline" href="/prestadores">Entrar no portal</Link>
      </section> : <form onSubmit={activate} className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-6">
        <p className="text-sm">Defina uma senha com pelo menos 12 caracteres para seu acesso individual.</p>
        {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
        <label className="block space-y-2 text-sm">Nova senha<Input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
        <label className="block space-y-2 text-sm">Confirmar senha<Input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
        <Button variant="primary-modal" className="w-full" disabled={busy || !token}>{busy ? "Ativando…" : "Definir senha"}</Button>
        {!token ? <p role="status" className="text-sm">Abra o link de convite enviado pelo RH.</p> : null}
      </form>}
    </div>
  </main>;
}
