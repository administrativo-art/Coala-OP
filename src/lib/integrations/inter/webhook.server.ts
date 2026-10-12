import "server-only";

import {
  configureCobrancaWebhook,
  retrieveConfiguredCobrancaWebhook,
} from "./cobrancas";
import { cleanInterCobrancaWebhookUrl } from "./webhook-contract";

export function targetInterCobrancaWebhookUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL não configurada.");
  return cleanInterCobrancaWebhookUrl(appUrl);
}

export function publicWebhookUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export async function ensureCleanInterCobrancaWebhook() {
  const target = targetInterCobrancaWebhookUrl();
  const configured = await retrieveConfiguredCobrancaWebhook();
  if (configured?.webhookUrl === target.toString()) {
    return { updated: false, webhookUrl: publicWebhookUrl(target.toString()) };
  }
  await configureCobrancaWebhook(target.toString());
  return { updated: true, webhookUrl: publicWebhookUrl(target.toString()) };
}

