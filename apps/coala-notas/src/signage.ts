import type { User } from "@firebase/auth";

import { appConfig } from "./config";
import { authenticatedJson } from "./upload";

export type SignageOrientation = "landscape" | "portrait";
export type SignageUnitScreen = { id: string; name: string; orientation: SignageOrientation | null; connected: boolean };
export type SignageUnit = { id: string; name: string; screens: SignageUnitScreen[]; nextScreenName: string; full: boolean };
export type AddedSignageScreen = { screen: { id: string; name: string; kioskName: string; orientation: SignageOrientation }; created: boolean };

export const ORIENTATION_LABEL: Record<SignageOrientation, string> = { landscape: "Horizontal", portrait: "Vertical" };
/** Endereço digitado no URL Launcher do monitor: é ele que instala o app da tela. */
export const signageInstallUrl = `${appConfig.apiBaseUrl}/app`;

export function loadSignageUnits(user: User) {
  return authenticatedJson<{ units: SignageUnit[] }>(user, "/api/signage/mobile");
}

/** Liga o monitor do QR code lido a uma tela nova ou, com `screenId`, a uma tela que já existe. */
export function addSignageScreen(user: User, input: { kioskId: string; screenId?: string; orientation: SignageOrientation; code: string }) {
  return authenticatedJson<AddedSignageScreen>(user, "/api/signage/mobile/screens", { method: "POST", body: JSON.stringify(input) });
}

// Mesmo formato que o servidor aceita: 8 caracteres sem 0, 1, I e O.
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** Código do monitor dentro do QR code; `null` quando o QR code lido não é de uma tela do Coala Signage. */
export function parsePairingCode(scanned: string) {
  const code = /[?&]tela=([A-Za-z0-9]{8})(?:[&#]|$)/.exec(scanned.trim())?.[1]?.toUpperCase() ?? "";
  return CODE.test(code) ? code : null;
}

export const simulationSignageUnits: SignageUnit[] = [
  { id: "simulation-unit", name: "Unidade de simulação", screens: [{ id: "simulation-unit", name: "Tela 1", orientation: "landscape", connected: true }], nextScreenName: "Tela 2", full: false },
  { id: "simulation-unit-2", name: "Unidade nova (simulação)", screens: [{ id: "simulation-unit-2", name: "Tela 1", orientation: null, connected: false }], nextScreenName: "Tela 1", full: false },
];
