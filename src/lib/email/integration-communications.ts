import "server-only";

import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import {
  DEFAULT_INTEGRATION_COMMUNICATIONS,
  type IntegrationCommunication,
  type IntegrationCommunicationEvent,
  type IntegrationTemplateVersion,
} from "@/features/hr/integration/schemas";

import { EMAIL_SENDERS, sendEmail } from "./resend";
import { renderCoalaEmail } from "./template";

const SYSTEM_URL = "https://op.coalashakes.com";

type CommunicationVariables = Record<string, string | null | undefined>;

export type SendTrackedIntegrationCommunicationInput = {
  onboardingId: string;
  event: IntegrationCommunicationEvent;
  template: IntegrationTemplateVersion;
  recipient: string;
  actionUrl: string;
  expiresAt?: string | null;
  variables: CommunicationVariables;
  force?: boolean;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "o prazo indicado no formulário";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "o prazo indicado no formulário";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Belem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function replaceVariables(value: string, variables: CommunicationVariables) {
  return value.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_match, key: string) => {
    const replacement = variables[key];
    return replacement === null || replacement === undefined || replacement === ""
      ? "—"
      : String(replacement);
  });
}

function defaultCommunication(event: IntegrationCommunicationEvent): IntegrationCommunication {
  const value = DEFAULT_INTEGRATION_COMMUNICATIONS.find((item) => item.event === event);
  if (!value) throw new Error(`Modelo padrão ausente para ${event}.`);
  return { ...value };
}

function resolveCommunication(
  template: IntegrationTemplateVersion,
  event: IntegrationCommunicationEvent,
) {
  return template.communications.find((item) => item.event === event) ?? defaultCommunication(event);
}

function plainText(title: string, message: string, buttonLabel: string, actionUrl: string, includeSystemUrl: boolean) {
  return [
    title,
    "",
    message,
    "",
    `${buttonLabel}: ${actionUrl}`,
    ...(includeSystemUrl ? ["", `Acessar o Coala One: ${SYSTEM_URL}`] : []),
    "",
    "Essa é uma mensagem automática, não responda esse e-mail.",
  ].join("\n");
}

export async function sendTrackedIntegrationCommunication(
  input: SendTrackedIntegrationCommunicationInput,
) {
  const communication = resolveCommunication(input.template, input.event);
  if (!communication.enabled) return { status: "disabled" as const };

  const recipient = input.recipient.trim().toLowerCase();
  if (!recipient || !recipient.includes("@")) {
    throw new Error("A comunicação não possui um destinatário válido.");
  }

  const ref = hrDbAdmin
    .collection("emailCommunications")
    .doc(`${input.onboardingId}_${input.event}`);
  const existing = await ref.get();
  if (!input.force && existing.exists && ["accepted", "delivered"].includes(String(existing.get("status") ?? ""))) {
    return {
      status: "already_sent" as const,
      providerId: typeof existing.get("providerId") === "string" ? existing.get("providerId") : null,
    };
  }

  const now = new Date().toISOString();
  const attempts = Number(existing.exists ? existing.get("attempts") ?? 0 : 0) + 1;
  const variables = {
    ...input.variables,
    "integration.formalization_deadline": formatDateTime(input.expiresAt),
    "integration.first_access_deadline": formatDateTime(input.expiresAt),
  };
  const subject = replaceVariables(communication.subject, variables);
  const title = replaceVariables(communication.title, variables);
  const message = replaceVariables(communication.message, variables);
  const isFirstAccess = input.event === "first_access";

  await ref.set({
    onboardingId: input.onboardingId,
    event: input.event,
    recipient,
    sender: isFirstAccess ? EMAIL_SENDERS.access : EMAIL_SENDERS.formalization,
    subject,
    status: "pending",
    attempts,
    templateId: input.template.templateId,
    templateVersion: input.template.version,
    updatedAt: now,
    createdAt: existing.exists ? existing.get("createdAt") ?? now : now,
  }, { merge: true });

  if (isFirstAccess) {
    await hrDbAdmin.collection("onboardingProcesses").doc(input.onboardingId).set({
      accessProvisioning: {
        status: "awaiting_delivery",
        email: {
          status: "pending",
          recipient,
          providerId: null,
          lastError: null,
          lastEventAt: now,
        },
      },
      updatedAt: now,
    }, { merge: true });
  }

  try {
    const result = await sendEmail({
      from: isFirstAccess ? EMAIL_SENDERS.access : EMAIL_SENDERS.formalization,
      to: recipient,
      subject,
      html: renderCoalaEmail({
        brandName: isFirstAccess ? "Coala One" : "Coala Shakes",
        title,
        message,
        action: { label: communication.buttonLabel, url: input.actionUrl },
        ...(isFirstAccess
          ? { secondaryAction: { label: "Acessar o Coala One", url: SYSTEM_URL } }
          : {}),
      }),
      text: plainText(title, message, communication.buttonLabel, input.actionUrl, isFirstAccess),
    });
    await ref.set({
      status: "accepted",
      providerId: result.id,
      acceptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastError: null,
    }, { merge: true });
    if (isFirstAccess) {
      await hrDbAdmin.collection("onboardingProcesses").doc(input.onboardingId).set({
        accessProvisioning: {
          status: "awaiting_delivery",
          email: {
            status: "accepted",
            providerId: result.id,
            recipient,
            acceptedAt: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            lastError: null,
          },
        },
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
    return { status: "accepted" as const, providerId: result.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Falha desconhecida no envio.";
    await Promise.all([
      ref.set({ status: "failed", lastError: errorMessage, updatedAt: new Date().toISOString() }, { merge: true }),
      ...(isFirstAccess ? [
        hrDbAdmin.collection("onboardingProcesses").doc(input.onboardingId).set({
          accessProvisioning: {
            status: "failed",
            email: {
              status: "failed",
              recipient,
              failedAt: new Date().toISOString(),
              lastEventAt: new Date().toISOString(),
              lastError: errorMessage,
            },
          },
          updatedAt: new Date().toISOString(),
        }, { merge: true }),
      ] : []),
      hrDbAdmin.collection("hrNotifications").doc(`email_failure_${input.onboardingId}_${input.event}`).set({
        type: "email_delivery_failure",
        status: "pending",
        onboardingId: input.onboardingId,
        title: "Falha ao enviar comunicação da integração",
        message: errorMessage,
        channels: ["in_app"],
        recipient: { strategy: "hr_pool" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true }),
    ]);
    return { status: "failed" as const, error: errorMessage };
  }
}
