"use client";
import { useCallback, useEffect, useState } from "react";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PortalClosures } from "@/features/service-portal/portal-closures";
import { portalRequest } from "@/features/service-portal/client";
import type { PortalPrincipal, ProviderGrant } from "@/features/service-portal/types";

type Session = { principal: PortalPrincipal; grants: (Pick<ProviderGrant, "id" | "employerUnitId" | "competence" | "expiresAt"> & { employerName: string; employerCnpj: string })[] };
const monthLabel = (value: string) => new Date(value + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

export default function ServicePortalPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [employerId, setEmployerId] = useState("");
  const [grantId, setGrantId] = useState("");
  const refresh = useCallback(async () => {
    try { setSession(await portalRequest<Session>("/api/service-portal/session")); }
    catch { setSession(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await portalRequest("/api/service-portal/login", { email, password });
      setPassword("");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível entrar."); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await portalRequest("/api/service-portal/logout", {}); setSession(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível sair."); }
    finally { setBusy(false); }
  }
  const employers = [...new Map((session?.grants ?? []).map((grant) => [grant.employerUnitId, { id: grant.employerUnitId, name: grant.employerName, cnpj: grant.employerCnpj }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  const activeEmployer = employers.some((employer) => employer.id === employerId) ? employerId : employers.length === 1 ? employers[0].id : "";
  const months = (session?.grants ?? []).filter((grant) => grant.employerUnitId === activeEmployer).sort((left, right) => right.competence.localeCompare(left.competence));
  const selected = months.find((grant) => grant.id === grantId) ?? (months.length === 1 ? months[0] : null);
  return <main className="min-h-screen bg-ds-page px-5 py-12 font-ds text-ds-ink">
    <div className={session ? "mx-auto max-w-4xl space-y-7" : "mx-auto max-w-md space-y-7"}>
      <header className="flex items-start justify-between gap-4">
        <div><p className="text-sm text-ds-ink-muted">Coala · Prestadores de serviço</p>
          <h1 className="mt-2 text-3xl font-bold">Portal do Contador</h1></div>
        {session ? <Button variant="ds-secondary" disabled={busy} onClick={() => void logout()}>Sair</Button> : null}
      </header>
      {error ? <p role="alert" className="text-sm text-ds-danger">{error}</p> : null}
      {loading ? <p role="status">Consultando seu acesso…</p> : session ? <>
        <p>Olá, {session.principal.name}.</p>
        <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Competências autorizadas</h2>
            <Button variant="ds-secondary" size="sm" onClick={() => void refresh()}>Atualizar</Button></div>
          {session.grants.length ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">Empresa<span className="relative block">
              <select aria-label="Empresa" value={activeEmployer} onChange={(event) => { setEmployerId(event.target.value); setGrantId(""); }} className="h-10 w-full appearance-none rounded-md border border-ds-border bg-ds-surface pl-3 pr-9">
                <option value="">Selecione uma empresa</option>{employers.map((employer) => <option key={employer.id} value={employer.id}>{employer.name}{employer.cnpj ? " · " + CnpjValidator.format(employer.cnpj) : ""}</option>)}
              </select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" />
            </span></label>
            <label className="space-y-1 text-sm">Competência<span className="relative block">
              <select aria-label="Competência" value={selected?.id ?? ""} disabled={!activeEmployer} onChange={(event) => setGrantId(event.target.value)} className="h-10 w-full appearance-none rounded-md border border-ds-border bg-ds-surface pl-3 pr-9 disabled:opacity-50">
                <option value="">Selecione uma competência</option>{months.map((grant) => <option key={grant.id} value={grant.id}>{monthLabel(grant.competence)}</option>)}
              </select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" />
            </span></label>
          </div> : null}
          {!session.grants.length ? <p className="text-sm text-ds-ink-muted">O RH ainda não liberou empresas e competências para sua conta.</p> :
            (selected ? [selected] : []).map((grant) => <article key={grant.id} className="space-y-1 border-t border-ds-border py-3">
              <h3 className="font-semibold">{monthLabel(grant.competence)}</h3>
              <p className="text-sm">Empresa · {grant.employerName}</p>
              <p className="text-sm text-ds-ink-muted">Acesso válido até {new Date(grant.expiresAt).toLocaleString("pt-BR")}.</p>
              <PortalClosures key={grant.id} grantId={grant.id} />
            </article>)}
        </section>
      </> : <form onSubmit={login} className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-6">
        <p className="text-sm text-ds-ink-muted">Entre com o acesso individual concedido ao seu escritório.</p>
        <label className="block space-y-2 text-sm">E-mail<Input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
        <label className="block space-y-2 text-sm">Senha<Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
        <Button variant="primary-modal" className="w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
        <p className="text-sm text-ds-ink-muted">No primeiro acesso ou para recuperar sua senha, solicite um convite ao RH.</p>
      </form>}
    </div>
  </main>;
}
