"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, LogOut, ShieldCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import type {
  ProfileComplianceField,
  ProfileComplianceFormValues,
  ProfileComplianceStatus,
} from "@/features/hr/profile-compliance";
import {
  cepDigits,
  formatBrazilianCep,
  lookupProfileAddressByCep,
} from "@/features/hr/profile-compliance-cep";

type CompliancePayload = {
  status: ProfileComplianceStatus;
  complete: boolean;
  reviewDue: boolean;
  missingFields: ProfileComplianceField[];
  invalidFields: ProfileComplianceField[];
  currentReviewStartedAt: string;
  nextReviewAt: string;
  values: ProfileComplianceFormValues;
};

const EMPTY_VALUES: ProfileComplianceFormValues = {
  birthDate: "",
  accessEmail: "",
  mobilePhone: "",
  pixKeyType: "",
  pixKey: "",
  addressZipcode: "",
  addressStreet: "",
  addressNumber: "",
  addressNoNumber: false,
  addressNeighborhood: "",
  addressCity: "",
  addressState: "",
  emergencyName: "",
  emergencyRelation: "",
  emergencyPhone: "",
};

const STEPS = ["Dados pessoais", "Endereço", "PIX", "Emergência", "Conferência"] as const;
const UF = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const RELATIONS = ["Mãe/Pai", "Cônjuge", "Filho(a)", "Irmão/Irmã", "Parente", "Amigo(a)", "Outro"];

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-100 disabled:text-slate-500";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      <span>{label} <span className="text-rose-500">*</span></span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

function missingForStep(step: number, values: ProfileComplianceFormValues) {
  if (step === 0) return !values.birthDate || !values.accessEmail || !values.mobilePhone;
  if (step === 1) return !values.addressZipcode || !values.addressStreet || (!values.addressNoNumber && !values.addressNumber) || !values.addressNeighborhood || !values.addressCity || !values.addressState;
  if (step === 2) return !values.pixKeyType || !values.pixKey;
  if (step === 3) return !values.emergencyName || !values.emergencyRelation || !values.emergencyPhone;
  return false;
}

export function ProfileComplianceGate({ children }: { children: React.ReactNode }) {
  const { firebaseUser, user, loading: authLoading, logout } = useAuth();
  const [payload, setPayload] = useState<CompliancePayload | null>(null);
  const [values, setValues] = useState<ProfileComplianceFormValues>(EMPTY_VALUES);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cepLookup, setCepLookup] = useState<{ status: "idle" | "loading" | "success" | "error"; message?: string }>({ status: "idle" });
  const cepRequestRef = useRef(0);
  const lastCepLookupRef = useRef("");

  useEffect(() => {
    if (authLoading || !firebaseUser || !user) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/profile-compliance", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const next = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(next.error ?? "Não foi possível verificar seu cadastro.");
        if (!cancelled) {
          setPayload(next as CompliancePayload);
          setValues((next as CompliancePayload).values);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Não foi possível verificar seu cadastro.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [authLoading, firebaseUser, user]);

  const update = <K extends keyof ProfileComplianceFormValues>(key: K, value: ProfileComplianceFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const lookupCep = useCallback(async (zipcode: string) => {
    const digits = cepDigits(zipcode);
    if (digits.length !== 8 || lastCepLookupRef.current === digits) return;

    lastCepLookupRef.current = digits;
    const requestId = ++cepRequestRef.current;
    setCepLookup({ status: "loading" });
    try {
      const address = await lookupProfileAddressByCep(digits);
      if (requestId !== cepRequestRef.current) return;
      setValues((current) => {
        if (cepDigits(current.addressZipcode) !== digits) return current;
        return {
          ...current,
          addressZipcode: address.zipcode,
          addressStreet: address.street,
          addressNeighborhood: address.neighborhood,
          addressCity: address.city,
          addressState: address.state,
        };
      });
      setCepLookup({ status: "success", message: "Endereço preenchido pelo CEP. Confira e informe o número." });
    } catch (lookupError) {
      if (requestId !== cepRequestRef.current) return;
      setCepLookup({
        status: "error",
        message: `${lookupError instanceof Error ? lookupError.message : "Não foi possível consultar o CEP."} Preencha o endereço manualmente.`,
      });
    }
  }, []);

  const updateZipcode = (value: string) => {
    const formatted = formatBrazilianCep(value);
    const digits = cepDigits(formatted);
    if (lastCepLookupRef.current !== digits) {
      cepRequestRef.current += 1;
      lastCepLookupRef.current = "";
      setCepLookup({ status: "idle" });
    }
    update("addressZipcode", formatted);
    if (digits.length === 8) void lookupCep(formatted);
  };

  useEffect(() => {
    if (!payload || step !== 1) return;
    const needsAddress = !values.addressStreet || !values.addressNeighborhood || !values.addressCity || !values.addressState;
    if (needsAddress && cepDigits(values.addressZipcode).length === 8) void lookupCep(values.addressZipcode);
  }, [lookupCep, payload, step, values.addressCity, values.addressNeighborhood, values.addressState, values.addressStreet, values.addressZipcode]);

  const summary = useMemo(() => [
    ["E-mail de acesso", values.accessEmail],
    ["Celular", values.mobilePhone],
    ["Endereço", `${values.addressStreet}, ${values.addressNoNumber ? "S/N" : values.addressNumber} — ${values.addressNeighborhood}, ${values.addressCity}/${values.addressState}`],
    ["Chave PIX", `${values.pixKeyType.toUpperCase()} · ${values.pixKey}`],
    ["Contato de emergência", `${values.emergencyName} · ${values.emergencyRelation} · ${values.emergencyPhone}`],
  ], [values]);

  const submit = async () => {
    if (!firebaseUser) return;
    setSaving(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/profile-compliance", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const next = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(next.error ?? "Não foi possível confirmar seu cadastro.");
      setPayload(next as CompliancePayload);
      setValues((next as CompliancePayload).values);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível confirmar seu cadastro.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !firebaseUser || !user) return <>{children}</>;
  if (payload?.status === "complete" && !payload.reviewDue) return <>{children}</>;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl place-items-center">
        <section className="w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <header className="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-700"><ShieldCheck className="h-6 w-6" /></div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Atualização obrigatória</p>
                <h1 className="text-xl font-black">Confirme seus dados cadastrais</h1>
                <p className="text-sm text-slate-500">Necessário para acessar o Coala One e renovado trimestralmente.</p>
              </div>
            </div>
            <button type="button" onClick={() => void logout()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </header>

          <div className="grid md:grid-cols-[220px_1fr]">
            <nav className="border-b border-slate-100 bg-slate-50/70 p-4 md:border-b-0 md:border-r">
              <ol className="grid grid-cols-5 gap-2 md:grid-cols-1">
                {STEPS.map((label, index) => (
                  <li key={label} className={`flex min-w-0 items-center gap-2 rounded-xl p-2 text-xs font-bold ${index === step ? "bg-white text-violet-700 shadow-sm" : index < step ? "text-emerald-700" : "text-slate-400"}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${index === step ? "bg-violet-600 text-white" : index < step ? "bg-emerald-100" : "bg-slate-200"}`}>
                      {index < step ? <Check className="h-4 w-4" /> : index + 1}
                    </span>
                    <span className="hidden truncate md:block">{label}</span>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="min-h-[510px] p-6 sm:p-8">
              {loading && !payload ? <div className="grid min-h-[420px] place-items-center text-sm text-slate-500">Verificando cadastro…</div> : null}
              {!loading && !payload && error ? (
                <div className="grid min-h-[420px] place-items-center text-center">
                  <div className="max-w-md space-y-4"><AlertCircle className="mx-auto h-10 w-10 text-rose-500" /><p className="font-bold">{error}</p><button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white">Tentar novamente</button></div>
                </div>
              ) : null}

              {payload ? (
                <div className="mx-auto max-w-2xl space-y-6">
                  <div><p className="text-xs font-bold uppercase tracking-wider text-violet-600">Etapa {step + 1} de {STEPS.length}</p><h2 className="mt-1 text-2xl font-black">{STEPS[step]}</h2></div>

                  {step === 0 ? <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Data de nascimento"><input type="date" value={values.birthDate} onChange={(event) => update("birthDate", event.target.value)} className={inputClass} /></Field>
                    <Field label="E-mail de acesso" hint="É o mesmo e-mail utilizado no login."><input type="email" value={values.accessEmail} disabled className={inputClass} /></Field>
                    <div className="sm:col-span-2"><Field label="Celular com DDD"><input type="tel" value={values.mobilePhone} onChange={(event) => update("mobilePhone", event.target.value)} placeholder="(98) 99999-9999" className={inputClass} /></Field></div>
                  </div> : null}

                  {step === 1 ? <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="CEP">
                      <input
                        value={values.addressZipcode}
                        onChange={(event) => updateZipcode(event.target.value)}
                        onBlur={() => void lookupCep(values.addressZipcode)}
                        inputMode="numeric"
                        autoComplete="postal-code"
                        maxLength={9}
                        placeholder="00000-000"
                        className={inputClass}
                      />
                      {cepLookup.status === "loading" ? <span className="text-xs font-normal text-slate-500">Buscando endereço…</span> : null}
                      {cepLookup.status === "success" ? <span className="text-xs font-normal text-emerald-700">{cepLookup.message}</span> : null}
                      {cepLookup.status === "error" ? <span className="text-xs font-normal text-amber-700">{cepLookup.message}</span> : null}
                    </Field>
                    <Field label="Logradouro"><input value={values.addressStreet} onChange={(event) => update("addressStreet", event.target.value)} className={inputClass} /></Field>
                    <Field label="Número"><input value={values.addressNumber} disabled={values.addressNoNumber} onChange={(event) => update("addressNumber", event.target.value)} className={inputClass} /><span className="flex items-center gap-2 text-xs font-normal"><input type="checkbox" checked={values.addressNoNumber} onChange={(event) => update("addressNoNumber", event.target.checked)} /> Endereço sem número</span></Field>
                    <Field label="Bairro"><input value={values.addressNeighborhood} onChange={(event) => update("addressNeighborhood", event.target.value)} className={inputClass} /></Field>
                    <Field label="Cidade"><input value={values.addressCity} onChange={(event) => update("addressCity", event.target.value)} className={inputClass} /></Field>
                    <Field label="UF"><select value={values.addressState} onChange={(event) => update("addressState", event.target.value)} className={inputClass}><option value="">Selecione…</option>{UF.map((uf) => <option key={uf}>{uf}</option>)}</select></Field>
                  </div> : null}

                  {step === 2 ? <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Tipo da chave PIX"><select value={values.pixKeyType} onChange={(event) => update("pixKeyType", event.target.value)} className={inputClass}><option value="">Selecione…</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="phone">Celular</option><option value="email">E-mail</option><option value="random">Chave aleatória</option></select></Field>
                    <Field label="Chave PIX" hint="Os dados bancários tradicionais não são necessários."><input value={values.pixKey} onChange={(event) => update("pixKey", event.target.value)} className={inputClass} /></Field>
                  </div> : null}

                  {step === 3 ? <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nome do contato"><input value={values.emergencyName} onChange={(event) => update("emergencyName", event.target.value)} className={inputClass} /></Field>
                    <Field label="Vínculo"><select value={values.emergencyRelation} onChange={(event) => update("emergencyRelation", event.target.value)} className={inputClass}><option value="">Selecione…</option>{RELATIONS.map((relation) => <option key={relation}>{relation}</option>)}</select></Field>
                    <div className="sm:col-span-2"><Field label="Telefone do contato"><input type="tel" value={values.emergencyPhone} onChange={(event) => update("emergencyPhone", event.target.value)} placeholder="(98) 99999-9999" className={inputClass} /></Field></div>
                  </div> : null}

                  {step === 4 ? <div className="space-y-3">
                    <p className="text-sm text-slate-600">Confira os dados abaixo. Ao confirmar, você declara que as informações estão atualizadas.</p>
                    {summary.map(([label, value]) => <div key={label} className="grid gap-1 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 sm:grid-cols-[180px_1fr]"><span className="text-xs font-bold uppercase text-slate-500">{label}</span><span className="break-all text-sm font-semibold">{value}</span></div>)}
                    <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-800">A próxima confirmação será solicitada no início do próximo trimestre.</p>
                  </div> : null}

                  {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p> : null}
                  <footer className="flex items-center justify-between border-t border-slate-100 pt-5">
                    <button type="button" disabled={step === 0 || saving} onClick={() => { setError(null); setStep((current) => current - 1); }} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-bold disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Voltar</button>
                    {step < STEPS.length - 1 ? <button type="button" disabled={missingForStep(step, values)} onClick={() => { setError(null); setStep((current) => current + 1); }} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white disabled:opacity-40">Continuar <ChevronRight className="h-4 w-4" /></button> : <button type="button" disabled={saving} onClick={() => void submit()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" /> {saving ? "Confirmando…" : "Confirmar e acessar"}</button>}
                  </footer>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
