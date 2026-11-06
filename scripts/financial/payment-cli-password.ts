import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import { PaymentCliError } from "./payment-cli-transport";

type HiddenPasswordDeps = {
  input: Readable & { isTTY?: boolean };
  output: Writable;
  setEcho: (enabled: boolean) => void;
};

/**
 * Lê a senha em modo canônico do terminal, só com o eco desligado.
 *
 * O modo bruto (setRawMode) recusou repetidamente a senha correta digitada pelo
 * operador no Terminal do macOS em 2026-11-06, enquanto o modo canônico aceitou na
 * primeira tentativa. Aqui o próprio terminal trata edição, apagar e composição de
 * caracteres; o eco é sempre restaurado, inclusive em erro ou Ctrl+C.
 */
export async function readHiddenPassword(deps: HiddenPasswordDeps, prompt = "Senha do Coala (não será exibida): ") {
  if (!deps.input.isTTY) throw new PaymentCliError("Execute login em um terminal interativo.");
  deps.output.write(prompt);
  deps.setEcho(false);
  const reader = createInterface({ input: deps.input, terminal: false });
  const restore = () => deps.setEcho(true);
  process.once("SIGINT", restore);
  try {
    const value = await new Promise<string>((resolve, reject) => {
      reader.once("line", resolve);
      reader.once("close", () => reject(new PaymentCliError("Login cancelado.")));
    });
    return value.replace(/\r$/, "");
  } finally {
    process.off("SIGINT", restore);
    reader.close();
    restore();
    deps.output.write("\n");
  }
}

export function setTerminalEcho(enabled: boolean) {
  const result = spawnSync("stty", [enabled ? "echo" : "-echo"], { stdio: ["inherit", "ignore", "ignore"] });
  if (result.status !== 0 && !enabled) throw new PaymentCliError("Não foi possível ocultar a senha neste terminal.");
}
