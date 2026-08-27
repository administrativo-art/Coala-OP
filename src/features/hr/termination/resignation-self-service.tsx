"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Circle,
  FileCheck2,
  FilePenLine,
  FileText,
  Loader2,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UploadCloud,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { terminationFetch } from "./client";
import {
  HANDWRITTEN_LETTER_CHECKLIST,
  buildHandwrittenResignationGuide,
  type HandwrittenLetterChecklistId,
  type ResignationNoticePreference,
} from "./resignation-guide";
import type { CltTerminationProcess } from "./types";

type WizardStep = 1 | 2 | 3 | 4 | 5;

const WIZARD_STEPS: Array<{ id: WizardStep; shortLabel: string }> = [
  { id: 1, shortLabel: "Orientação" },
  { id: 2, shortLabel: "Aviso" },
  { id: 3, shortLabel: "Carta" },
  { id: 4, shortLabel: "Envio" },
  { id: 5, shortLabel: "Confirmação" },
];

const INITIAL_CHECKLIST = Object.fromEntries(
  HANDWRITTEN_LETTER_CHECKLIST.map((item) => [item.id, false]),
) as Record<HandwrittenLetterChecklistId, boolean>;

function dateLabel(value?: string | null) {
  if (!value) return "Não informado";
  return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
}

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function WizardProgress({ current }: { current: WizardStep }) {
  return (
    <div className="rounded-2xl border border-[#e5e3de] bg-white px-4 py-4 shadow-sm sm:px-5">
      <div className="flex items-center justify-between gap-2">
        {WIZARD_STEPS.map((item, index) => {
          const completed = item.id < current;
          const active = item.id === current;
          return (
            <div key={item.id} className="flex min-w-0 flex-1 items-center last:flex-none">
              <div className="flex min-w-0 flex-col items-center gap-1.5">
                <span className={`grid h-8 w-8 place-items-center rounded-full border text-xs font-black transition-colors ${
                  completed
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : active
                      ? "border-pink-600 bg-pink-600 text-white shadow-[0_0_0_4px_rgba(219,39,119,0.12)]"
                      : "border-slate-200 bg-white text-slate-400"
                }`}>
                  {completed ? <Check className="h-4 w-4" /> : item.id}
                </span>
                <span className={`hidden text-[10px] font-black sm:block ${active ? "text-pink-700" : completed ? "text-slate-600" : "text-slate-400"}`}>
                  {item.shortLabel}
                </span>
              </div>
              {index < WIZARD_STEPS.length - 1 ? (
                <span className={`mx-2 mb-5 h-0.5 flex-1 rounded-full sm:mx-3 ${completed ? "bg-emerald-300" : "bg-slate-200"}`} />
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-400 sm:hidden">
        Passo {current} de {WIZARD_STEPS.length} · {WIZARD_STEPS[current - 1].shortLabel}
      </p>
    </div>
  );
}

function ProcessStatusLine({
  label,
  description,
  state,
}: {
  label: string;
  description: string;
  state: "completed" | "active" | "pending";
}) {
  return (
    <div className="flex gap-3 py-3.5">
      {state === "completed"
        ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        : state === "active"
          ? <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-pink-100"><span className="h-2 w-2 rounded-full bg-pink-600" /></span>
          : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
      <div>
        <p className={`text-sm font-black ${state === "pending" ? "text-slate-500" : "text-slate-900"}`}>{label}</p>
        <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function ActiveResignation({
  process,
  signatureUrl,
  profileHref,
  refreshing,
  busy,
  error,
  onRefresh,
  onReplaceLetter,
}: {
  process: CltTerminationProcess;
  signatureUrl: string | null;
  profileHref: string;
  refreshing: boolean;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onReplaceLetter: (file: File) => Promise<void>;
}) {
  const identityCompleted = ["verified", "manual_verified"].includes(process.request.identityStatus);
  const letterCompleted = process.steps.find((item) => item.id === "letter_review")?.status === "completed";
  const correctionRequested = process.hrValidation?.status === "correction_requested";
  const noticeCompleted = Boolean(process.notice);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);

  return (
    <div className="min-h-full bg-[#f0eee9] px-4 py-6 text-[#1d1d26] sm:px-7 sm:py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Button asChild variant="outline" className="rounded-xl border-[#dedbd4] bg-white font-bold">
          <Link href={profileHref}><ArrowLeft className="h-4 w-4" /> Voltar ao meu perfil</Link>
        </Button>

        <section className="overflow-hidden rounded-[24px] border border-[#e2e0da] bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.4)]">
          <div className="border-b border-[#efede8] bg-gradient-to-br from-white to-pink-50/70 px-5 py-6 sm:px-7">
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-pink-600">Meu pedido de demissão</span>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Pedido recebido</h1>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">
              Acompanhe cada confirmação do seu pedido. O protocolo preserva a carta, os horários e as decisões do processo.
            </p>
          </div>

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-7">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Protocolo</p>
              <p className="mt-1 font-mono text-sm font-black text-slate-800">{process.request.protocol}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Situação atual</p>
              <p className="mt-1 text-sm font-black text-slate-800">{process.currentSummary}</p>
            </div>
          </div>

          <div className="border-t border-[#efede8] px-5 py-3 sm:px-7">
            <ProcessStatusLine label="Carta manuscrita enviada" description="O arquivo original foi preservado junto ao protocolo." state="completed" />
            <div className="border-t border-slate-100" />
            <ProcessStatusLine
              label="Conferência da carta pelo RH"
              description={letterCompleted ? "A carta foi aprovada pelo RH." : correctionRequested ? "O RH solicitou uma nova versão da carta." : "O RH está conferindo se a carta está manuscrita, datada e assinada."}
              state={letterCompleted ? "completed" : "active"}
            />
            <div className="border-t border-slate-100" />
            <ProcessStatusLine
              label="Confirmação de identidade e formalização"
              description={identityCompleted ? "Identidade confirmada e assinatura eletrônica concluída." : letterCompleted ? "Assine o comprovante eletrônico usando a confirmação por SMS." : "Esta etapa será liberada depois da aprovação da carta."}
              state={identityCompleted ? "completed" : letterCompleted ? "active" : "pending"}
            />
            <div className="border-t border-slate-100" />
            <ProcessStatusLine
              label="Definição do aviso e das datas"
              description={noticeCompleted ? `Término definido para ${dateLabel(process.notice?.contractEndDate)}.` : "A decisão da empresa aparecerá aqui quando for registrada."}
              state={noticeCompleted ? "completed" : identityCompleted ? "active" : "pending"}
            />
          </div>

          {error ? <div className="border-t border-rose-100 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-800 sm:px-7">{error}</div> : null}

          {correctionRequested ? (
            <div className="border-t border-amber-100 bg-amber-50 px-5 py-5 sm:px-7">
              <p className="text-sm font-black text-amber-950">O RH solicitou uma nova versão da carta</p>
              <p className="mt-1 whitespace-pre-line text-xs font-semibold leading-relaxed text-amber-800">{process.hrValidation?.notes}</p>
              <div className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-white p-4">
                <Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} />
                <label className="flex items-start gap-3 text-xs font-semibold text-slate-700"><Checkbox checked={replacementConfirmed} onCheckedChange={(checked) => setReplacementConfirmed(checked === true)} />Confirmo que a nova carta foi escrita integralmente à mão, datada e assinada.</label>
                <Button disabled={busy || !replacement || !replacementConfirmed} onClick={() => replacement ? void onReplaceLetter(replacement) : undefined} className="rounded-xl bg-pink-600 font-black hover:bg-pink-700"><UploadCloud className="h-4 w-4" />{busy ? "Enviando..." : "Enviar nova versão ao RH"}</Button>
              </div>
            </div>
          ) : null}

          {!identityCompleted && letterCompleted ? (
            <div className="border-t border-pink-100 bg-pink-50 px-5 py-5 sm:px-7">
              <p className="text-sm font-black text-pink-950">Falta confirmar sua identidade</p>
              <p className="mt-1 text-xs font-semibold leading-relaxed text-pink-800">
                A confirmação acontece na assinatura eletrônica. Um código será enviado por SMS ao celular cadastrado.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {signatureUrl ? (
                  <Button asChild className="rounded-xl bg-pink-600 font-black hover:bg-pink-700">
                    <a href={signatureUrl} target="_blank" rel="noreferrer"><ShieldCheck className="h-4 w-4" /> Confirmar identidade e assinar</a>
                  </Button>
                ) : (
                  <p className="rounded-xl border border-pink-200 bg-white px-4 py-3 text-xs font-semibold text-pink-800">
                    Use o link de assinatura encaminhado ao seu e-mail. Depois, volte aqui para acompanhar.
                  </p>
                )}
                <Button variant="outline" disabled={refreshing} onClick={onRefresh} className="rounded-xl bg-white font-bold">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Atualizar situação
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export function ResignationSelfService() {
  const searchParams = useSearchParams();
  const { firebaseUser, user, permissions } = useAuth();
  const [mine, setMine] = useState<CltTerminationProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStep>(1);
  const [noticePreference, setNoticePreference] = useState<ResignationNoticePreference | null>(null);
  const [desiredLastDay, setDesiredLastDay] = useState("");
  const [letter, setLetter] = useState<File | null>(null);
  const [letterPreviewUrl, setLetterPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState(INITIAL_CHECKLIST);
  const [finalConfirmation, setFinalConfirmation] = useState(false);

  const loadMine = useCallback(async (showRefresh = false) => {
    if (!firebaseUser) return;
    if (showRefresh) setRefreshing(true);
    try {
      const result = await terminationFetch<{ processes: CltTerminationProcess[] }>(firebaseUser, "/api/hr/terminations?scope=mine");
      setMine(result.processes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar seu pedido.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    void loadMine();
  }, [firebaseUser, loadMine]);

  useEffect(() => {
    if (!letter) {
      setLetterPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(letter);
    setLetterPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [letter]);

  const active = mine.find((item) => !["completed", "cancelled"].includes(item.status));
  const profileHref = user?.id ? `/dashboard/dp/collaborators/${user.id}` : "/dashboard";
  const canPreview = Boolean(
    permissions.settings?.manageUsers === true || permissions.dp?.collaborators?.terminate === true,
  );
  const previewMode = searchParams.get("preview") === "1" && canPreview;
  const eligible = previewMode || (user?.employmentRelationshipType === "clt" && user?.isActive !== false);
  const phoneReady = previewMode || Boolean(user?.phone && user?.phoneVerifiedAt);
  const checklistCompleted = HANDWRITTEN_LETTER_CHECKLIST.every((item) => checklist[item.id]);
  const guide = useMemo(() => noticePreference ? buildHandwrittenResignationGuide({
    employeeName: previewMode ? "Scooby Doo" : user?.username,
    jobRoleName: previewMode ? "Atendente" : user?.jobRoleName,
    noticePreference,
  }) : "", [noticePreference, previewMode, user?.jobRoleName, user?.username]);

  function selectLetter(file: File | null) {
    setError(null);
    if (!file) {
      setLetter(null);
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png"].includes(file.type);
    if (!allowed) {
      setError("Envie a carta em PDF, JPG ou PNG.");
      return;
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      setError("A carta deve ter no máximo 12 MB.");
      return;
    }
    setLetter(file);
  }

  function goNext() {
    setError(null);
    if (step === 1 && !phoneReady) {
      setError("Seu celular precisa estar cadastrado e verificado antes de iniciar o pedido.");
      return;
    }
    if (step === 2 && !noticePreference) {
      setError("Informe sua preferência sobre o aviso-prévio.");
      return;
    }
    if (step === 2 && noticePreference === "request_waiver" && !desiredLastDay) {
      setError("Informe o último dia desejado.");
      return;
    }
    if (step === 4 && !previewMode && !letter) {
      setError("Fotografe ou anexe a carta manuscrita assinada.");
      return;
    }
    if (step === 4 && !previewMode && !checklistCompleted) {
      setError("Confirme todos os itens da conferência da carta.");
      return;
    }
    if (step < 5) setStep((step + 1) as WizardStep);
  }

  function goBack() {
    setError(null);
    if (step > 1) setStep((step - 1) as WizardStep);
  }

  async function submitRequest() {
    if (!firebaseUser || !letter || !noticePreference || !checklistCompleted || !finalConfirmation) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("letter", letter);
      form.append("noticePreference", noticePreference);
      form.append("desiredLastDay", desiredLastDay);
      form.append("notes", notes.trim());
      form.append("handwrittenConfirmed", "true");
      const result = await terminationFetch<{ process: CltTerminationProcess; signatureUrl: string | null }>(
        firebaseUser,
        "/api/hr/terminations",
        { method: "POST", body: form },
      );
      setMine((current) => [result.process, ...current]);
      setSignatureUrl(result.signatureUrl);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Falha ao enviar o pedido.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="grid min-h-[420px] place-items-center text-sm font-semibold text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Carregando pedido...</div>;
  }

  if (active && !previewMode) {
    return (
      <ActiveResignation
        process={active}
        signatureUrl={signatureUrl}
        profileHref={profileHref}
        refreshing={refreshing}
        busy={busy}
        error={error}
        onRefresh={() => void loadMine(true)}
        onReplaceLetter={async (file) => {
          if (!firebaseUser) return;
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.append("letter", file);
            form.append("handwrittenConfirmed", "true");
            await terminationFetch(firebaseUser, `/api/hr/terminations/${active.id}/letter`, { method: "POST", body: form });
            await loadMine(true);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Falha ao enviar a nova carta.");
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  if (!eligible) {
    return (
      <div className="min-h-full bg-[#f0eee9] p-4 sm:p-8">
        <div className="mx-auto max-w-xl rounded-[24px] border border-[#e2e0da] bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-500" />
          <h1 className="mt-3 text-xl font-black text-slate-950">Pedido indisponível</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">Este fluxo está disponível somente para colaboradores com vínculo CLT ativo.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline" className="rounded-xl"><Link href={profileHref}>Voltar ao meu perfil</Link></Button>
            {canPreview ? (
              <Button asChild className="rounded-xl bg-pink-600 font-black hover:bg-pink-700"><Link href="/dashboard/resignation?preview=1">Visualizar experiência</Link></Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f0eee9] px-4 py-5 text-[#1d1d26] sm:px-7 sm:py-7">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" className="rounded-xl border-[#dedbd4] bg-white font-bold">
            <Link href={profileHref}><ArrowLeft className="h-4 w-4" /> Voltar ao meu perfil</Link>
          </Button>
          <span className="rounded-full border border-rose-100 bg-rose-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.09em] text-rose-700">
            Uso exclusivo do titular
          </span>
        </div>

        <header>
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-pink-600">Meu vínculo</span>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Pedido de demissão</h1>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
            Siga cada etapa para preparar sua carta manuscrita, enviar o arquivo e formalizar o pedido com segurança.
          </p>
        </header>

        <WizardProgress current={step} />

        {previewMode ? (
          <div className="flex gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div><strong>Modo de prévia.</strong> Você pode percorrer toda a experiência, mas nenhuma solicitação será enviada.</div>
          </div>
        ) : null}

        {error ? (
          <div className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-[24px] border border-[#e2e0da] bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.4)]">
          {step === 1 ? (
            <div>
              <div className="border-b border-[#efede8] bg-gradient-to-br from-white to-pink-50/60 px-5 py-6 sm:px-8">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-pink-100 text-pink-700"><FilePenLine className="h-5 w-5" /></span>
                <p className="mt-5 text-[10px] font-black uppercase tracking-[0.11em] text-pink-600">Passo 1 de 5</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Antes de começar</h2>
                <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
                  Todo pedido de demissão deve conter uma carta escrita integralmente à mão, datada e assinada pelo colaborador.
                </p>
              </div>
              <div className="grid gap-4 px-5 py-6 sm:grid-cols-2 sm:px-8">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-black text-slate-900">Você vai precisar de</p>
                  <ul className="mt-3 space-y-2.5 text-sm font-medium text-slate-600">
                    <li className="flex gap-2"><PenLine className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" /> Papel e caneta para escrever a carta.</li>
                    <li className="flex gap-2"><UploadCloud className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" /> Celular ou scanner para enviar o arquivo.</li>
                    <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" /> Celular cadastrado para confirmar sua identidade.</li>
                  </ul>
                </div>
                <div className={`rounded-2xl border p-5 ${phoneReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex items-start gap-3">
                    {phoneReady ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />}
                    <div>
                      <p className={`text-sm font-black ${phoneReady ? "text-emerald-900" : "text-amber-900"}`}>
                        {phoneReady ? "Celular pronto para confirmação" : "Celular ainda não verificado"}
                      </p>
                      <p className={`mt-1 text-xs font-semibold leading-relaxed ${phoneReady ? "text-emerald-700" : "text-amber-800"}`}>
                        {phoneReady
                          ? "A assinatura eletrônica usará o número que já está validado no seu cadastro."
                          : "Solicite ao RH a atualização e verificação do seu celular antes de continuar."}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="sm:col-span-2 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-xs font-semibold leading-relaxed text-sky-800">
                  O envio da carta registra sua manifestação. A preferência de aviso-prévio será analisada e a decisão da empresa aparecerá no acompanhamento do processo.
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <div className="border-b border-[#efede8] px-5 py-6 sm:px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.11em] text-pink-600">Passo 2 de 5</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Qual é sua preferência sobre o aviso?</h2>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">Sua escolha será inserida no modelo que você copiará à mão.</p>
              </div>
              <div className="space-y-4 px-5 py-6 sm:px-8">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => { setNoticePreference("work"); setDesiredLastDay(""); }}
                    className={`rounded-2xl border p-5 text-left transition ${noticePreference === "work" ? "border-pink-300 bg-pink-50 ring-2 ring-pink-100" : "border-slate-200 hover:border-pink-200 hover:bg-pink-50/40"}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-black text-slate-900">Pretendo cumprir o aviso-prévio</span>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border ${noticePreference === "work" ? "border-pink-600 bg-pink-600 text-white" : "border-slate-300"}`}>
                        {noticePreference === "work" ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                    </span>
                    <span className="mt-2 block text-xs font-medium leading-relaxed text-slate-500">O modelo informará a intenção de cumprir os 30 dias.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoticePreference("request_waiver")}
                    className={`rounded-2xl border p-5 text-left transition ${noticePreference === "request_waiver" ? "border-pink-300 bg-pink-50 ring-2 ring-pink-100" : "border-slate-200 hover:border-pink-200 hover:bg-pink-50/40"}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-black text-slate-900">Solicito dispensa do aviso-prévio</span>
                      <span className={`grid h-5 w-5 place-items-center rounded-full border ${noticePreference === "request_waiver" ? "border-pink-600 bg-pink-600 text-white" : "border-slate-300"}`}>
                        {noticePreference === "request_waiver" ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                    </span>
                    <span className="mt-2 block text-xs font-medium leading-relaxed text-slate-500">A empresa ainda precisará analisar e registrar a decisão.</span>
                  </button>
                </div>
                {noticePreference === "request_waiver" ? (
                  <label className="block max-w-sm text-sm font-black text-slate-800">
                    Último dia desejado
                    <Input type="date" value={desiredLastDay} onChange={(event) => setDesiredLastDay(event.target.value)} className="mt-2 h-11 rounded-xl font-semibold" />
                    <span className="mt-1.5 block text-xs font-medium text-slate-500">Esta data é uma solicitação e poderá ser ajustada pelo RH.</span>
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <div className="border-b border-[#efede8] px-5 py-6 sm:px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.11em] text-pink-600">Passo 3 de 5</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Copie o modelo à mão</h2>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">Use o texto abaixo como guia. Complete os campos entre colchetes e assine a carta.</p>
              </div>
              <div className="space-y-4 px-5 py-6 sm:px-8">
                <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p className="font-semibold"><strong>Não imprima o modelo apenas para assinar.</strong> A carta deve ser escrita integralmente à mão.</p>
                </div>
                <div className="rounded-[20px] border border-[#ddd9d0] bg-[#fffefb] p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)] sm:p-7">
                  <pre className="whitespace-pre-wrap font-serif text-[13px] leading-6 text-slate-800 sm:text-sm">{guide}</pre>
                </div>
                <p className="text-xs font-semibold text-slate-500">Quando terminar de escrever, datar e assinar, avance para fotografar ou anexar a carta.</p>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <div className="border-b border-[#efede8] px-5 py-6 sm:px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.11em] text-pink-600">Passo 4 de 5</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Envie e confira sua carta</h2>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">Anexe uma foto nítida ou um PDF da carta manuscrita assinada.</p>
              </div>
              <div className="space-y-5 px-5 py-6 sm:px-8">
                {!letter ? (
                  <label className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-pink-200 bg-pink-50/50 p-6 text-center transition hover:border-pink-400 hover:bg-pink-50">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-pink-600 shadow-sm"><UploadCloud className="h-6 w-6" /></span>
                    <span className="mt-4 text-sm font-black text-slate-900">Fotografar ou selecionar a carta</span>
                    <span className="mt-1 text-xs font-medium text-slate-500">PDF, JPG ou PNG · máximo de 12 MB</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="sr-only"
                      onChange={(event) => selectLetter(event.target.files?.[0] ?? null)}
                    />
                  </label>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pink-100 text-pink-700"><FileText className="h-4 w-4" /></span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{letter.name}</p>
                          <p className="text-[11px] font-semibold text-slate-400">{fileSizeLabel(letter.size)}</p>
                        </div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => selectLetter(null)} className="rounded-xl bg-white font-bold">Substituir arquivo</Button>
                    </div>
                    {letterPreviewUrl && letter.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={letterPreviewUrl} alt="Prévia da carta manuscrita" className="mx-auto max-h-[520px] w-auto max-w-full object-contain p-4" />
                    ) : letterPreviewUrl ? (
                      <iframe src={letterPreviewUrl} title="Prévia da carta manuscrita" className="h-[480px] w-full bg-white" />
                    ) : null}
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-sm font-black text-slate-900">Conferência obrigatória</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">Marque cada item somente depois de conferir o arquivo enviado.</p>
                  <div className="mt-4 space-y-3">
                    {HANDWRITTEN_LETTER_CHECKLIST.map((item) => (
                      <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-700">
                        <Checkbox
                          checked={checklist[item.id]}
                          onCheckedChange={(checked) => setChecklist((current) => ({ ...current, [item.id]: checked === true }))}
                          className="mt-0.5"
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div>
              <div className="border-b border-[#efede8] px-5 py-6 sm:px-8">
                <p className="text-[10px] font-black uppercase tracking-[0.11em] text-pink-600">Passo 5 de 5</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Revise e envie ao RH</h2>
                <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">Confira o resumo antes de criar o protocolo. O RH revisará a carta antes de liberar a assinatura eletrônica.</p>
              </div>
              <div className="space-y-5 px-5 py-6 sm:px-8">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Aviso-prévio</p>
                    <p className="mt-1.5 text-sm font-black text-slate-800">{noticePreference === "work" ? "Pretendo cumprir" : "Solicito dispensa"}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Último dia desejado</p>
                    <p className="mt-1.5 text-sm font-black text-slate-800">{dateLabel(desiredLastDay)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Carta</p>
                    <p className="mt-1.5 truncate text-sm font-black text-slate-800">{letter?.name ?? (previewMode ? "Carta manuscrita de exemplo" : "—")}</p>
                  </div>
                </div>

                <label className="block text-sm font-black text-slate-800">
                  Observação para o RH <span className="font-medium text-slate-400">(opcional)</span>
                  <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Se necessário, acrescente uma informação sobre seu pedido." className="mt-2 min-h-24 rounded-xl font-medium" />
                </label>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-pink-200 bg-pink-50 p-4 text-sm font-semibold leading-relaxed text-pink-950">
                  <Checkbox checked={finalConfirmation} onCheckedChange={(checked) => setFinalConfirmation(checked === true)} className="mt-0.5" />
                  <span>Confirmo que escrevi integralmente à mão, datei, assinei e anexei esta carta, e que desejo formalizar meu pedido de demissão.</span>
                </label>

                <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-xs font-semibold leading-relaxed text-sky-800">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                  Depois que o RH aprovar a carta, você assinará um comprovante eletrônico. A confirmação de identidade utilizará um código enviado por SMS.
                </div>
              </div>
            </div>
          ) : null}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#efede8] bg-[#fbfaf7] px-5 py-4 sm:px-8">
            <Button type="button" variant="ghost" disabled={step === 1 || busy} onClick={goBack} className="font-bold text-slate-600">
              <ChevronLeft className="h-4 w-4" /> Voltar
            </Button>
            {step < 5 ? (
              <Button type="button" disabled={busy || (step === 1 && !phoneReady)} onClick={goNext} className="rounded-xl bg-pink-600 px-5 font-black hover:bg-pink-700">
                Continuar <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" disabled={busy || !finalConfirmation || previewMode} onClick={() => void submitRequest()} className="rounded-xl bg-pink-600 px-5 font-black hover:bg-pink-700">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                {previewMode ? "Envio desativado na prévia" : busy ? "Enviando..." : "Enviar pedido ao RH"}
              </Button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
