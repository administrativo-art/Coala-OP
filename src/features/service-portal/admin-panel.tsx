"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";
import { ClosureReleasePanel } from "./closure-release-panel";
import type { ProviderOffice, ProviderMember, ProviderGrant, PortalManagementResult } from "./types";

type Overview = { offices: ProviderOffice[]; members: ProviderMember[]; grants: ProviderGrant[]; employers: { id: string; name: string; cnpj: string }[] };
export function ServiceProvidersAdmin({ firebaseUser }: { firebaseUser: User | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [officeName, setOfficeName] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberId, setMemberId] = useState("");
  const [employerUnitId, setEmployerUnitId] = useState("");
  const [competence, setCompetence] = useState("");
  const [expires, setExpires] = useState("");
  const [invitation, setInvitation] = useState<{ url: string; expiresAt: string } | null>(null);
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const api = useCallback(<T,>(options = {}) => authenticatedApiRequest<T>("/api/dp/service-providers", {
    getIdToken: () => firebaseUser?.getIdToken() ?? Promise.resolve(null), ...options,
  }), [firebaseUser]);
  const load = useCallback(async () => {
    try { setData(await api<Overview>()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível consultar os prestadores."); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  async function act(input: Record<string, unknown>, creates = false) {
    const fingerprint = JSON.stringify(input);
    const confirms = input.action === "reissue_invitation" || input.action === "revoke_grant"
      || (input.action === "set_member_active" || input.action === "set_office_active") && input.active === false;
    if (confirms && confirming !== fingerprint) { setConfirming(fingerprint); return; }
    setConfirming("");
    setBusy(true); setError(""); setInvitation(null);
    if (creates && pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const result = await api<PortalManagementResult>({ method: "POST", body: JSON.stringify({ ...input, ...(creates ? { requestId: pending.current!.requestId } : {}) }) });
      pending.current = null;
      if (result.invitation) setInvitation({
        url: window.location.origin + "/prestadores/ativar#token=" + encodeURIComponent(result.invitation.token),
        expiresAt: result.invitation.expiresAt,
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  if (!data) return <section>{error ? <p role="alert" className="text-ds-danger">{error}</p> : <p role="status">Consultando prestadores…</p>}</section>;
  const officeLabel = (id: string) => data.offices.find((office) => office.id === id)?.name ?? "Escritório";
  const employerLabel = (id: string) => data.employers.find((employer) => employer.id === id)?.name ?? "Empresa";
  const memberLabel = (id: string) => data.members.find((member) => member.id === id)?.name ?? "Profissional";
  return <div className="space-y-6">
    {confirming ? <p role="status" className="text-sm">Clique novamente na mesma ação para confirmar a alteração de acesso.</p> : null}
    {error ? <p role="alert" className="text-ds-danger">{error}</p> : null}
    {invitation ? <section className="space-y-2 rounded-ds-card border border-ds-border bg-ds-surface p-5">
      <h2 className="font-bold">Convite de primeiro acesso</h2>
      <p className="text-sm">Compartilhe este link com o profissional. Ele definirá a própria senha. Válido até {new Date(invitation.expiresAt).toLocaleString("pt-BR")}.</p>
      <Input aria-label="Link do convite" readOnly value={invitation.url} onFocus={(event) => event.target.select()} />
      <Button variant="ds-secondary" size="sm" onClick={() => setInvitation(null)}>Fechar convite</Button>
    </section> : null}
    <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5">
      <h2 className="text-lg font-bold">Escritórios</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void act({ action: "create_office", name: officeName }, true); }}>
        <label className="min-w-64 flex-1 space-y-1 text-sm">Nome do escritório<Input required minLength={2} maxLength={160} value={officeName} onChange={(event) => setOfficeName(event.target.value)} disabled={busy} /></label>
        <Button variant="ds-secondary" disabled={busy}>Cadastrar escritório</Button>
      </form>
      {data.offices.map((office) => <div key={office.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border py-3">
        <p>{office.name} · {office.active ? "Ativo" : "Suspenso"}</p>
        <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void act({ action: "set_office_active", officeId: office.id, active: !office.active })}>
          {office.active ? "Suspender escritório" : "Reativar escritório"}
        </Button>
      </div>)}
    </section>
    <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5">
      <h2 className="text-lg font-bold">Profissionais de contabilidade</h2>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void act({ action: "invite_member", officeId, name, email }, true); }}>
        <label className="space-y-1 text-sm">Escritório<span className="relative block"><select required className="block h-10 w-full appearance-none rounded-md border border-ds-border bg-ds-surface pl-3 pr-9" value={officeId} onChange={(event) => setOfficeId(event.target.value)} disabled={busy}>
          <option value="">Selecione</option>{data.offices.filter((office) => office.active).map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
        </select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" /></span></label>
        <label className="space-y-1 text-sm">Nome do profissional<Input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
        <label className="space-y-1 text-sm">E-mail individual<Input type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
        <div className="flex items-end"><Button variant="ds-secondary" disabled={busy}>Gerar convite</Button></div>
      </form>
      {data.members.map((member) => <div key={member.id} className="space-y-2 border-t border-ds-border py-3">
        <p className="font-semibold">{member.name}</p><p className="text-sm text-ds-ink-muted">{member.email} · {officeLabel(member.officeId)} · {member.active ? member.status === "invited" ? "Aguardando primeiro acesso" : "Ativo" : "Suspenso"}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void act({ action: "set_member_active", memberId: member.id, active: !member.active })}>{member.active ? "Suspender acesso" : "Reativar acesso"}</Button>
          <Button variant="ds-secondary" size="sm" disabled={busy || !member.active} onClick={() => void act({ action: "reissue_invitation", memberId: member.id }, true)}>Gerar novo convite e redefinir acesso</Button>
        </div>
      </div>)}
    </section>
    <section className="space-y-4 rounded-ds-card border border-ds-border bg-ds-surface p-5">
      <h2 className="text-lg font-bold">Empresas e competências autorizadas</h2>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void act({ action: "grant", memberId, employerUnitId, competence, expiresAt: new Date(expires).toISOString() }, true); }}>
        <label className="space-y-1 text-sm">Profissional<span className="relative block"><select required className="block h-10 w-full appearance-none rounded-md border border-ds-border bg-ds-surface pl-3 pr-9" value={memberId} onChange={(event) => setMemberId(event.target.value)} disabled={busy}>
          <option value="">Selecione</option>{data.members.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.name} · {officeLabel(member.officeId)}</option>)}
        </select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" /></span></label>
        <label className="space-y-1 text-sm">Empresa empregadora<span className="relative block"><select required className="block h-10 w-full appearance-none rounded-md border border-ds-border bg-ds-surface pl-3 pr-9" value={employerUnitId} onChange={(event) => setEmployerUnitId(event.target.value)} disabled={busy}>
          <option value="">Selecione</option>{data.employers.map((employer) => <option key={employer.id} value={employer.id}>{employer.name} · {employer.cnpj}</option>)}
        </select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3 h-4 w-4" /></span></label>
        <label className="space-y-1 text-sm">Competência<Input type="month" required value={competence} onChange={(event) => setCompetence(event.target.value)} disabled={busy} /></label>
        <label className="space-y-1 text-sm">Acesso válido até<Input type="datetime-local" required value={expires} onChange={(event) => setExpires(event.target.value)} disabled={busy} /></label>
        <div><Button variant="ds-secondary" disabled={busy}>Liberar competência</Button></div>
      </form>
      {data.grants.map((grant) => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border py-3 text-sm">
        <p>{memberLabel(grant.memberId)} · {employerLabel(grant.employerUnitId)} · {new Date(grant.competence + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}<br />
          {grant.revokedAt ? "Revogado" : new Date(grant.expiresAt) <= new Date() ? "Expirado" : "Liberado"} · até {new Date(grant.expiresAt).toLocaleString("pt-BR")}</p>
        {!grant.revokedAt ? <Button variant="ds-secondary" size="sm" disabled={busy} onClick={() => void act({ action: "revoke_grant", grantId: grant.id })}>Revogar acesso</Button> : null}
        {!grant.revokedAt && new Date(grant.expiresAt) > new Date() ? <ClosureReleasePanel key={grant.id} grantId={grant.id} firebaseUser={firebaseUser} /> : null}
      </div>)}
    </section>
  </div>;
}
