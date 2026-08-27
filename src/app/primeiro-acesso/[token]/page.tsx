"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; email: string | null; username: string | null; expiresAt: string | null; pdvAccess: { required: boolean; completed: boolean; profileName: string | null; filialName: string | null } }
  | { status: "done"; email: string | null }
  | { status: "error"; message: string };

export default function FirstAccessPage() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const token = useMemo(() => String(params?.token ?? ""), [params?.token]);
  const [state, setState] = useState<LinkState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [step, setStep] = useState<"pdv" | "coala">("coala");

  useEffect(() => {
    const preview = searchParams.get("preview");
    if (process.env.NODE_ENV === "development" && (preview === "pdv" || preview === "coala")) {
      setStep(preview);
      setState({
        status: "ready",
        email: "colaborador@exemplo.com",
        username: "Maria Joana Barbosa",
        expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        pdvAccess: {
          required: true,
          completed: preview === "coala",
          profileName: "Atendente Quiosque",
          filialName: "COALA SHAKES TIRIRICAL",
        },
      });
      return;
    }
    let active = true;
    fetch(`/api/auth/first-access/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Link invalido.");
        return payload as {
          email?: string | null;
          username?: string | null;
          expiresAt?: string | null;
          pdvAccess?: { required: boolean; completed: boolean; profileName: string | null; filialName: string | null };
        };
      })
      .then((payload) => {
        if (!active) return;
        const pdvAccess = payload.pdvAccess ?? { required: false, completed: false, profileName: null, filialName: null };
        setStep(pdvAccess.required && !pdvAccess.completed ? "pdv" : "coala");
        setState({
          status: "ready",
          email: payload.email ?? null,
          username: payload.username ?? null,
          expiresAt: payload.expiresAt ?? null,
          pdvAccess,
        });
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Link invalido." });
      });
    return () => {
      active = false;
    };
  }, [searchParams, token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (step === "pdv" ? !/^[1-9]\d{3}$/.test(password) : password.length < 8) {
      setFormError(step === "pdv" ? "A senha do PDV deve ter exatamente 4 números e não pode começar com zero." : "A senha deve ter pelo menos 8 caracteres.");
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
        body: JSON.stringify({ action: step === "pdv" ? "pdv_password" : "coala_password", password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Nao foi possivel definir a senha.");
      if (step === "pdv") {
        setPassword("");
        setConfirmPassword("");
        setStep("coala");
      } else {
        setState({ status: "done", email: typeof payload?.email === "string" ? payload.email : null });
      }
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
              {state.pdvAccess.required ? (
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  <span className={step === "pdv" ? "text-pink-600" : "text-emerald-600"}>1. PDV Legal</span>
                  <span>→</span>
                  <span className={step === "coala" ? "text-pink-600" : ""}>2. Coala One</span>
                </div>
              ) : null}
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-4">
                <p className="text-sm font-bold text-slate-900">{state.username ?? "Novo colaborador"}</p>
                <p className="mt-1 text-sm text-slate-600">{state.email ?? "E-mail nao informado"}</p>
                {state.expiresAt ? (
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    Link válido por 48 horas, até {new Date(state.expiresAt).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })} às {new Date(state.expiresAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}.
                  </p>
                ) : null}
              </div>

              {step === "pdv" ? (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm">
                  <p className="font-black text-blue-900">Crie primeiro sua senha numérica do PDV Legal</p>
                  <p className="mt-1 font-semibold text-blue-700">
                    {state.pdvAccess.filialName ?? "Filial vinculada"} · {state.pdvAccess.profileName ?? "Perfil definido pelo RH"}
                  </p>
                  <p className="mt-3 rounded-lg border border-blue-200 bg-white/70 px-3 py-2 font-semibold text-blue-950">
                    Seu nome de usuário no PDV será:{" "}
                    <strong>{state.username ?? "nome informado pelo RH"}</strong>
                  </p>
                  <p className="mt-2 font-semibold text-blue-800">
                    O PDV não usa seu e-mail. Na máquina de cartão ou no caixa, selecione seu nome de usuário e digite a senha de 4 números que você cadastrar abaixo.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 text-sm">
                  <p className="font-black text-pink-900">Crie agora sua senha do Coala One</p>
                  <p className="mt-2 font-semibold text-pink-800">
                    Seu usuário de acesso será:{" "}
                    <strong>{state.email ?? "e-mail informado pelo RH"}</strong>
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold text-pink-800">
                    <li>Use pelo menos 8 caracteres.</li>
                    <li>Você pode usar letras, números e símbolos.</li>
                    <li>Letras maiúsculas e minúsculas são diferentes.</li>
                  </ul>
                  {state.pdvAccess.required ? (
                    <p className="mt-2 font-semibold text-pink-900">
                      Esta senha é independente da senha numérica criada para o PDV Legal.
                    </p>
                  ) : null}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-bold text-slate-800">
                  {step === "pdv" ? "Senha do PDV Legal" : "Nova senha do Coala One"}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    inputMode={step === "pdv" ? "numeric" : undefined}
                    maxLength={step === "pdv" ? 4 : undefined}
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
                  Confirmar {step === "pdv" ? "senha do PDV" : "senha"}
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
                {step === "pdv" ? "Criar senha do PDV e continuar" : "Criar senha do Coala One"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
