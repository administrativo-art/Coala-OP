import assert from "node:assert/strict";
import test from "node:test";

import { renderCoalaEmail } from "../../../src/lib/email/template";

test("renderCoalaEmail escapa conteúdo informado pelo usuário", () => {
  const html = renderCoalaEmail({
    title: "Alerta <urgente>",
    message: 'Estoque de "produto" & insumo',
    action: { label: "Ver <agora>", url: "https://op.coalashakes.com/?a=1&b=2" },
  });

  assert.match(html, /Alerta &lt;urgente&gt;/);
  assert.match(html, /Estoque de &quot;produto&quot; &amp; insumo/);
  assert.match(html, /Ver &lt;agora&gt;/);
  assert.match(html, /a=1&amp;b=2/);
  assert.doesNotMatch(html, /<urgente>/);
});

test("renderCoalaEmail converte quebras de linha", () => {
  const html = renderCoalaEmail({ title: "Resumo", message: "Linha 1\nLinha 2" });
  assert.match(html, /Linha 1<br \/>Linha 2/);
});

test("renderCoalaEmail usa a marca Coala One e oferece acesso secundário", () => {
  const html = renderCoalaEmail({
    title: "Acesso pronto",
    message: "Cadastre sua senha.",
    action: { label: "Cadastrar senha", url: "https://op.coalashakes.com/primeiro-acesso/token" },
    secondaryAction: { label: "Acessar o Coala One", url: "https://op.coalashakes.com" },
  });

  assert.match(html, />Coala One</);
  assert.match(html, />Cadastrar senha</);
  assert.match(html, />Acessar o Coala One</);
  assert.match(html, /Essa é uma mensagem automática, não responda esse e-mail\./);
});
