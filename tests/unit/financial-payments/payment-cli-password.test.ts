import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { readHiddenPassword } from "../../../scripts/financial/payment-cli-password";

function terminal() {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = new PassThrough();
  const echo: boolean[] = [];
  return { input, output, echo, deps: { input, output, setEcho: (enabled: boolean) => { echo.push(enabled); } } };
}

test("lê a linha digitada com eco desligado e restaura o eco", async () => {
  const t = terminal();
  const pending = readHiddenPassword(t.deps);
  t.input.write("Abcdefghijkl1\r\n");
  assert.equal(await pending, "Abcdefghijkl1");
  assert.deepEqual(t.echo, [false, true]);
});

test("preserva espaços, acentos e símbolos sem alterar a senha", async () => {
  const t = terminal();
  const pending = readHiddenPassword(t.deps);
  t.input.write(" Senha ção#1 \n");
  assert.equal(await pending, " Senha ção#1 ");
});

test("restaura o eco quando a entrada termina sem senha", async () => {
  const t = terminal();
  const pending = readHiddenPassword(t.deps);
  t.input.end();
  await assert.rejects(pending, /Login cancelado/);
  assert.deepEqual(t.echo, [false, true]);
});

test("recusa entrada que não é terminal sem tocar no eco", async () => {
  const t = terminal();
  t.input.isTTY = false;
  await assert.rejects(readHiddenPassword(t.deps), /terminal interativo/);
  assert.deepEqual(t.echo, []);
});
