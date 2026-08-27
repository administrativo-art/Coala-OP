"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { ImageVoiceConsentRecord, OnboardingPrivacyAcknowledgementRecord } from "@/types/rh";

type Props = {
  employeeId: string;
  initialConsent: ImageVoiceConsentRecord | null;
  privacyAcknowledgement: OnboardingPrivacyAcknowledgementRecord | null;
  canRevoke?: boolean;
};

function formatAnsweredAt(value?: string) {
  if (!value) return "Data não disponível";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Belem",
  }).format(date);
}

export function ImageVoiceConsentCard({
  employeeId,
  initialConsent,
  privacyAcknowledgement,
  canRevoke = true,
}: Props) {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [consent, setConsent] = useState(initialConsent);
  const [revoking, setRevoking] = useState(false);

  async function revoke() {
    if (!consent?.autorizado || revoking) return;
    const confirmed = window.confirm(
      "Deseja revogar a autorização de uso de imagem e voz? O time de Marketing/Administrativo será avisado para remover materiais dos canais digitais próprios em prazo razoável.",
    );
    if (!confirmed) return;

    setRevoking(true);
    try {
      if (!firebaseUser) throw new Error("Sessão expirada. Entre novamente.");
      const token = await firebaseUser.getIdToken();
      const response = await fetch(
        `/api/rh/employee-profile/${encodeURIComponent(employeeId)}/image-voice-consent`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Falha ao revogar autorização.");
      setConsent(payload.consentimento_imagem_voz as ImageVoiceConsentRecord);
      toast({ title: "Autorização de imagem e voz revogada." });
    } catch (error) {
      toast({
        title: "Não foi possível revogar a autorização.",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRevoking(false);
    }
  }

  const privacyAnsweredAt = privacyAcknowledgement?.lastConfirmedAt
    ?? privacyAcknowledgement?.firstAcceptedAt
    ?? undefined;

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900">Privacidade e autorizações</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Registros informados pelo candidato durante a admissão.
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-gray-800">Aviso de Privacidade (LGPD)</p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              {privacyAcknowledgement?.acknowledged
                ? "Ciência do Aviso de Privacidade confirmada. Esta ciência não é consentimento genérico."
                : "Nenhuma ciência do Aviso de Privacidade registrada neste perfil."}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${privacyAcknowledgement?.acknowledged ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600"}`}>
            {privacyAcknowledgement?.acknowledged ? "Ciente" : "Sem registro"}
          </span>
        </div>
        {privacyAcknowledgement?.acknowledged ? (
          <p className="mt-2 text-[11px] text-gray-400">
            Confirmado em {formatAnsweredAt(privacyAnsweredAt)} · Aviso {privacyAcknowledgement.noticeVersion}
          </p>
        ) : null}
        {privacyAcknowledgement?.allergyAcknowledged ? (
          <p className="mt-2 border-t border-gray-200 pt-2 text-[11px] text-gray-500">
            Ciência sobre o tratamento de informações de alergias confirmada
            {privacyAcknowledgement.allergyNoticeVersion ? ` · Aviso ${privacyAcknowledgement.allergyNoticeVersion}` : ""}.
          </p>
        ) : null}
      </div>

      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${consent?.autorizado ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
          {consent?.autorizado ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-gray-900">Uso de imagem e voz (opcional)</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            {consent?.autorizado
              ? "Autorização vigente. Você pode mudar de ideia a qualquer momento."
              : "Você não possui autorização vigente para uso de imagem e voz."}
          </p>
          {consent ? (
            <p className="mt-2 text-[11px] text-gray-400">
              Respondido em {formatAnsweredAt(consent.respondido_em)} · Termo {consent.versao_termo}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-gray-400">Nenhuma resposta registrada neste perfil.</p>
          )}
        </div>
      </div>

      {consent?.autorizado && canRevoke ? (
        <button
          type="button"
          onClick={revoke}
          disabled={revoking}
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
          {revoking ? "Revogando..." : "Revogar autorização de imagem e voz"}
        </button>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        A revogação será comunicada ao Marketing/Administrativo para retirada de materiais dos canais digitais próprios em prazo razoável. Materiais impressos já distribuídos anteriormente não são afetados.
      </p>
    </section>
  );
}
