"use client";

import { useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  RotateCw,
  Send,
  X,
  XCircle,
} from "lucide-react";

import type { AdmissionSignatureParticipant } from "@/features/hr/documents/admission-signature-layout";

function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function SignatureParticipantCard({
  participant,
  canManage,
  busyAction,
  onResend,
  onCreateLink,
  onReplaceEmail,
}: {
  participant: AdmissionSignatureParticipant;
  canManage: boolean;
  busyAction: string | null;
  onResend: (participant: AdmissionSignatureParticipant) => Promise<boolean>;
  onCreateLink: (participant: AdmissionSignatureParticipant) => Promise<string | null>;
  onReplaceEmail: (
    participant: AdmissionSignatureParticipant,
    email: string,
  ) => Promise<boolean>;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [email, setEmail] = useState(participant.email);
  const [feedback, setFeedback] = useState<string | null>(null);
  const terminal = participant.status === "signed" || participant.status === "rejected";
  const actionPrefix = `participant:${participant.providerSignatureId}:`;
  const busy = Boolean(busyAction?.startsWith(actionPrefix));
  const rejected = participant.status === "rejected";
  const deliveryFailed = participant.status === "delivery_failed";
  const events = [
    {
      label: "Convite enviado",
      at: participant.emailSentAt ?? participant.invitedAt,
      icon: Send,
    },
    {
      label: deliveryFailed ? "Falha na entrega do e-mail" : "E-mail entregue",
      at: deliveryFailed ? participant.emailSentAt ?? participant.invitedAt : participant.emailDeliveredAt,
      icon: deliveryFailed ? XCircle : Mail,
      failed: deliveryFailed,
    },
    { label: "E-mail aberto", at: participant.emailOpenedAt, icon: Mail },
    { label: "Documento aberto", at: participant.viewedAt, icon: Eye },
    {
      label: rejected ? "Assinatura recusada" : "Documento assinado",
      at: participant.rejectedAt ?? participant.signedAt,
      icon: rejected ? XCircle : CheckCircle2,
      failed: rejected,
    },
  ];

  async function resend() {
    menuRef.current?.removeAttribute("open");
    setFeedback(null);
    if (await onResend(participant)) setFeedback("Convite reenviado para este signatário.");
  }

  async function createLink() {
    menuRef.current?.removeAttribute("open");
    setFeedback(null);
    const link = await onCreateLink(participant);
    if (!link) return;
    await copyText(link);
    setFeedback("Link exclusivo copiado. Envie somente ao signatário indicado.");
  }

  async function replaceEmail(event: React.FormEvent) {
    event.preventDefault();
    setFeedback(null);
    if (!await onReplaceEmail(participant, email)) return;
    setReplaceOpen(false);
    setFeedback("Destinatário substituído e novo convite enviado.");
  }

  return (
    <>
      <article className={`rounded-xl border bg-white p-3.5 ${
        rejected || deliveryFailed ? "border-rose-200" : "border-slate-200"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wide text-violet-700">
              {participant.party === "employee" ? "Colaborador" : "Empregador"}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-black text-slate-900">{participant.name}</p>
            <p className="mt-0.5 break-all text-[10.5px] font-semibold text-slate-500">{participant.email}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full px-2 py-1 text-[8.5px] font-black uppercase ${
              participant.status === "signed"
                ? "bg-emerald-100 text-emerald-700"
                : rejected || deliveryFailed
                  ? "bg-rose-100 text-rose-700"
                  : participant.status === "viewed"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-600"
            }`}>
              {participant.status === "signed"
                ? "Assinado"
                : rejected
                  ? "Recusado"
                  : deliveryFailed
                    ? "Falha na entrega"
                    : participant.status === "viewed"
                      ? "Visualizado"
                      : "Enviado"}
            </span>
            {canManage && !terminal ? (
              <details ref={menuRef} className="relative">
                <summary
                  className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
                  aria-label={`Opções de ${participant.name}`}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                </summary>
                <div className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <button type="button" disabled={busy} onClick={() => void resend()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <RotateCw className="h-3.5 w-3.5" />Reenviar convite
                  </button>
                  <button type="button" disabled={busy} onClick={() => void createLink()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <Link2 className="h-3.5 w-3.5" />Copiar link exclusivo
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      menuRef.current?.removeAttribute("open");
                      setEmail(participant.email);
                      setReplaceOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" />Alterar e-mail e reenviar
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        </div>

        <div className="mt-3 space-y-0.5 border-t border-slate-100 pt-2.5">
          {events.map((event, index) => {
            const at = formatDateTime(event.at);
            return (
              <div key={event.label} className="relative flex gap-2.5 pb-2 last:pb-0">
                {index < events.length - 1 ? <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-slate-200" /> : null}
                <span className={`relative grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full ${
                  event.failed ? "bg-rose-100 text-rose-600" : at ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                }`}>
                  {at && !event.failed ? <Check className="h-3 w-3" /> : <event.icon className="h-3 w-3" />}
                </span>
                <div className="min-w-0 pt-px">
                  <p className={`text-[10px] font-black ${event.failed ? "text-rose-700" : at ? "text-slate-700" : "text-slate-400"}`}>{event.label}</p>
                  <p className="mt-0.5 text-[9px] font-semibold text-slate-400">{at ?? "Pendente"}</p>
                </div>
              </div>
            );
          })}
        </div>

        {participant.lastResentAt ? (
          <p className="mt-2 text-[9px] font-semibold text-slate-400">
            Último reenvio: {formatDateTime(participant.lastResentAt)}
            {participant.resendCount ? ` · ${participant.resendCount} reenvio(s)` : ""}
          </p>
        ) : null}
        {participant.lastIp ? (
          <p className="mt-1 text-[9px] font-semibold text-slate-400">
            Último evento técnico: IP {participant.lastIp}{participant.lastPort ? `:${participant.lastPort}` : ""}
          </p>
        ) : null}
        {feedback ? <p className="mt-2 rounded-lg bg-violet-50 px-2.5 py-2 text-[9.5px] font-bold text-violet-700">{feedback}</p> : null}
      </article>

      {replaceOpen ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Alterar e-mail do signatário">
          <form onSubmit={replaceEmail} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Alterar e-mail e reenviar</p>
                <p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">
                  O destinatário pendente será substituído somente neste kit. O papel e o posicionamento das rubricas e da assinatura serão preservados.
                </p>
              </div>
              <button type="button" onClick={() => setReplaceOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-slate-500" aria-label="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-4 block text-[10px] font-black uppercase tracking-wide text-slate-500" htmlFor={`replacement-email-${participant.providerSignatureId}`}>Novo e-mail</label>
            <input
              id={`replacement-email-${participant.providerSignatureId}`}
              type="email"
              required
              autoFocus
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReplaceOpen(false)} className="h-9 rounded-xl border border-slate-200 px-3 text-[11px] font-black text-slate-600">Cancelar</button>
              <button type="submit" disabled={busy || email.trim().toLowerCase() === participant.email.toLowerCase()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-violet-600 px-3 text-[11px] font-black text-white disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Substituir e reenviar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
