"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; email: string | null; username: string | null; expiresAt: string | null }
  | { status: "done"; email: string | null }
  | { status: "error"; message: string };

export default function FirstAccessPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params?.token ?? ""), [params?.token]);
  const [state, setState] = useState<LinkState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/auth/first-access/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Link invalido.");
        return payload as { email?: string | null; username?: string | null; expiresAt?: string | null };
      })
      .then((payload) => {
        if (!active) return;
        setState({
          status: "ready",
          email: payload.email ?? null,
          username: payload.username ?? null,
          expiresAt: payload.expiresAt ?? null,
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Link invalido." });
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("As senhas nao coincidem.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/first-access/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Nao foi possivel definir a senha.");
      setState({ status: "done", email: typeof payload?.email === "string" ? payload.email : null });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Nao foi possivel definir a senha.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F4ECD8] px-5 py-10 text-[#241A24]">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-xl items-center">
        <div className="w-full rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-pink-50 text-pink-600">
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-pink-600">Coala Shakes</p>
              <h1 className="text-2xl font-black">Primeiro acesso</h1>
            </div>
          </div>

          {state.status === "loading" && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando link...
            </div>
          )}

          {state.status === "error" && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-5">
              <p className="text-sm font-bold text-red-800">{state.message}</p>
              <p className="mt-1 text-sm text-red-700">Peça ao RH para gerar e enviar um novo link.</p>
            </div>
          )}

          {state.status === "done" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-5">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Senha criada com sucesso.
                </div>
                <p className="mt-1 text-sm text-emerald-700">
                  Use seu e-mail para entrar no sistema.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#E91E8C] px-4 text-sm font-black text-white hover:bg-[#C4187A]"
              >
                Entrar no sistema
              </Link>
            </div>
          )}

          {state.status === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-4">
                <p className="text-sm font-bold text-slate-900">{state.username ?? "Novo colaborador"}</p>
                <p className="mt-1 text-sm text-slate-600">{state.email ?? "E-mail nao informado"}</p>
                {state.expiresAt ? (
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    Link valido ate {new Date(state.expiresAt).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-bold text-slate-800">
                  Nova senha
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-12 text-sm font-semibold outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-bold text-slate-800">
                  Confirmar senha
                </label>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
                />
              </div>

              {formError ? (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {formError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#E91E8C] px-4 text-sm font-black text-white hover:bg-[#C4187A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Criar senha
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
