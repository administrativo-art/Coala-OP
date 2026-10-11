import * as Application from "expo-application";
import { File, Paths } from "expo-file-system";
import { getContentUriAsync } from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

import { appConfig } from "./config";

export type AppRelease = { versionCode: number; versionName: string; minVersionCode: number; packagePath: string };
export type UpdateState = "current" | "available" | "required";

// O servidor corta respostas acima de ~30 MB e o instalador passa disso: baixa em partes (Range) e junta no aparelho.
const CHUNK_BYTES = 8 * 1024 * 1024;

/** Versão instalada (`versionCode` do Android); 0 quando não dá para saber (desenvolvimento, iOS, web). */
export function installedVersionCode() {
  if (Platform.OS !== "android") return 0;
  const code = Number(Application.nativeBuildVersion);
  return Number.isFinite(code) ? code : 0;
}

/** Versão publicada no sistema; `null` sem internet ou com resposta inesperada (o aplicativo segue normalmente). */
export async function loadRelease(): Promise<AppRelease | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/app/version`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AppRelease>;
    if (typeof body.versionCode !== "number" || typeof body.minVersionCode !== "number" || typeof body.packagePath !== "string" || !body.packagePath.startsWith("/")) return null;
    return { versionCode: body.versionCode, versionName: String(body.versionName ?? ""), minVersionCode: body.minVersionCode, packagePath: body.packagePath };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function updateState(release: AppRelease | null, installed: number): UpdateState {
  if (!release || installed <= 0) return "current";
  if (installed < release.minVersionCode) return "required";
  return installed < release.versionCode ? "available" : "current";
}

async function fetchPart(url: string, start: number) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` }, cache: "no-store" });
  const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
  // 206 + Content-Range: qualquer outra resposta seria um arquivo inteiro ou cortado, que não pode ser instalado.
  if (response.status !== 206 || !range || Number(range[1]) !== start) throw new Error("O servidor não entregou o instalador em partes. Tente de novo.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== Number(range[2]) - Number(range[1]) + 1) throw new Error("Download incompleto. Tente de novo.");
  return { bytes, total: Number(range[3]) };
}

/** Baixa o instalador para o cache do aparelho e abre o instalador do Android, que pede a confirmação da pessoa. */
export async function downloadAndInstall(release: AppRelease, onProgress: (percent: number) => void) {
  const url = `${appConfig.apiBaseUrl}${release.packagePath}`;
  const file = new File(Paths.cache, "CoalaOne-atualizacao.apk");
  if (file.exists) file.delete();
  file.create();
  const handle = file.open();
  try {
    let written = 0;
    let total = Infinity;
    while (written < total) {
      const part = await fetchPart(url, written);
      total = part.total;
      handle.writeBytes(part.bytes);
      written += part.bytes.length;
      onProgress(Math.min(100, Math.round((written / total) * 100)));
    }
  } catch (cause) {
    handle.close();
    file.delete();
    throw cause;
  }
  handle.close();
  const data = await getContentUriAsync(file.uri);
  // O Android confere a assinatura: só um APK assinado com a mesma chave do Coala One é aceito por cima.
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data, flags: 1, type: "application/vnd.android.package-archive" });
}
