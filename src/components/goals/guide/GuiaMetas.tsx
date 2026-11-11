'use client';

/**
 * Guia de Metas e Bonificação INTERATIVO (Coala Shakes).
 * É o PDF do guia, página por página, mas com todos os números ligados ao faturamento.
 * Depende só de `react` e de `./bonificacao`. Estilos embutidos (prefixo `gm-`).
 *
 *   <GuiaMetas />
 *   <GuiaMetas config={configDaUnidade} faturamentoInicial={36000} />
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  CONFIG_PADRAO,
  calcularBonificacao,
  formatarReais as reais,
  type ConfigBonificacao,
  type EntradaSimulacao,
  type ResultadoMeta,
  type ResultadoSimulacao,
} from './bonificacao';

export interface GuiaMetasProps {
  config?: ConfigBonificacao;
  faturamentoInicial?: number;
  diasMesInicial?: number;
  diasFolguistaInicial?: number;
  pessoasFixasInicial?: number;
  onChange?: (entrada: EntradaSimulacao, resultado: ResultadoSimulacao) => void;
  className?: string;
}

type Cor = 'rosa' | 'azul' | 'roxo' | 'laranja';
type Token = string | { v: string; s?: string; res?: boolean };
const OPS = new Set(['−', '×', '÷', '=', '+']);
const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/* ---------- peças ---------- */

function Pulso({ valor, className }: { valor: string; className?: string }) {
  return (
    <b key={valor} className={`gm-pulso ${className ?? ''}`}>
      {valor}
    </b>
  );
}

function Conta({ itens, cor = 'rosa' }: { itens: Token[]; cor?: Cor }) {
  return (
    <div className={`gm-conta gm-${cor}`}>
      {itens.map((t, i) =>
        typeof t === 'string' && OPS.has(t) ? (
          <span key={i} className="gm-op" aria-hidden="true">{t}</span>
        ) : typeof t === 'string' ? (
          <span key={i} className="gm-tag">{t}</span>
        ) : (
          <span key={i} className={`gm-tag ${t.res ? 'gm-res' : ''}`}>
            {t.s && <small>{t.s}</small>}
            {t.res ? <Pulso valor={t.v} /> : t.v}
          </span>
        ),
      )}
    </div>
  );
}

function Pagina({ n, total, id, children }: { n: number; total: number; id: string; children: React.ReactNode }) {
  return (
    <section className="gm-pg" id={id}>
      <div className="gm-pg-top" />
      <div className="gm-pg-cab">COALA SHAKES | GUIA DE METAS E BONIFICAÇÃO</div>
      <div className="gm-pg-corpo">{children}</div>
      <div className="gm-pg-rod">
        <span>Valores ilustrativos | Guia de metas e bonificação</span>
        <span>{n} / {total}</span>
      </div>
    </section>
  );
}

function Titulo({ n, cor = 'rosa', children }: { n?: number; cor?: Cor; children: React.ReactNode }) {
  return (
    <h2 className={`gm-h2 gm-${cor}`}>
      {n !== undefined && <span className="gm-num">{n}</span>}
      <span>{children}</span>
    </h2>
  );
}

function Caixa({ titulo, cor = 'rosa', children }: { titulo?: string; cor?: Cor; children: React.ReactNode }) {
  return (
    <aside className={`gm-caixa gm-${cor}`}>
      {titulo && <b className="gm-caixa-t">{titulo}</b>}
      {children}
    </aside>
  );
}

function Trava({ children }: { children: React.ReactNode }) {
  return <div className="gm-trava-pg">🔒 {children}</div>;
}

function Contador({ rotulo, valor, min, max, onChange, sufixo }: { rotulo: string; valor: number; min: number; max: number; onChange: (v: number) => void; sufixo: string }) {
  const id = useId();
  return (
    <div className="gm-contador">
      <span id={id} className="gm-contador-rotulo">{rotulo}</span>
      <div className="gm-contador-ctrl" role="group" aria-labelledby={id}>
        <button type="button" aria-label={`Diminuir ${rotulo}`} disabled={valor <= min} onClick={() => onChange(Math.max(min, valor - 1))}>−</button>
        <output aria-live="polite"><b>{valor}</b> <small>{sufixo}</small></output>
        <button type="button" aria-label={`Aumentar ${rotulo}`} disabled={valor >= max} onClick={() => onChange(Math.min(max, valor + 1))}>+</button>
      </div>
    </div>
  );
}

function Bandeira() {
  return (
    <svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true">
      <line x1="3" y1="2" x2="3" y2="25" stroke="#2b2433" strokeWidth="2.5" strokeLinecap="round" />
      <polygon points="3,2 21,8 3,15" fill="#dc7a12" />
    </svg>
  );
}

/** Régua dos pedaços das vendas (o desenho "sem extra | 8% | 10% | 12%"), fora de escala. */
function Regua({ r, destaque, legenda = false }: { r: ResultadoSimulacao; destaque?: number; legenda?: boolean }) {
  const metas = r.metas;
  const M = metas.length;
  const fat = r.faturamento;
  const larg0 = 28;
  const largM = M ? (100 - larg0) / M : 100 - larg0;
  const vão = M > 1 ? metas[M - 1].valor - metas[M - 2].valor : 3000;
  const segs = [
    { rotulo: 'sem extra', w: larg0, preenche: metas[0] ? Math.min(1, fat / metas[0].valor) : 1 },
    ...metas.map((m, i) => ({
      rotulo: `${m.percentual}%`,
      w: largM,
      preenche: !m.atingida ? 0 : metas[i + 1] ? m.vendidoNoPedaco / (metas[i + 1].valor - m.valor) : Math.min(0.95, m.vendidoNoPedaco / (vão * 1.5)),
    })),
  ];
  let acum = 0;
  let pos = 0;
  segs.forEach((sg, i) => {
    const preenchidoAteAqui = acum + sg.w * sg.preenche;
    if (sg.preenche > 0 || i === 0) pos = preenchidoAteAqui;
    acum += sg.w;
  });
  const desloca = pos < 18 ? 0 : pos > 82 ? 100 : 50;
  const idx = r.metasAtingidas - 1;
  const mAt = idx >= 0 ? metas[idx] : undefined;
  const mProx = idx + 1 < M ? metas[idx + 1] : undefined;
  let onde: React.ReactNode;
  if (!mAt) onde = <>A loja ainda está antes da primeira meta, no trecho <b>sem extra</b>. Faltam <b>{reais(metas[0]?.faltam ?? 0)}</b> para a {metas[0]?.nome}.</>;
  else if (fat === mAt.valor) onde = <>A loja está <b>exatamente na {mAt.nome}</b>. A partir daqui, cada real vendido a mais rende <b>{mAt.percentual}%</b> de extra.</>;
  else if (mProx) onde = <>A loja está no <b>pedaço do {mAt.percentual}%</b>, entre a {mAt.nome} e a {mProx.nome}. Faltam <b>{reais(mProx.faltam)}</b> para a {mProx.nome}.</>;
  else onde = <>A loja passou da {mAt.nome} e está no <b>pedaço do {mAt.percentual}%</b>, que não tem fim.</>;
  return (
    <div className="gm-reg">
      <div className="gm-pin">
        <span style={{ left: `${pos}%`, transform: `translateX(-${desloca}%)` }}>Nossa loja: {reais(fat)}</span>
      </div>
      <div className="gm-marca" style={{ left: `${pos}%` }} aria-hidden="true"><i /></div>
      <div className="gm-regua" role="img" aria-label="Pedaços das vendas e suas porcentagens">
        {segs.map((sg, i) => (
          <div key={i} className={`gm-seg ${destaque !== undefined && destaque !== i ? 'gm-dim' : ''}`} style={{ flexGrow: sg.w, flexBasis: 0 }}>
            <div className={`gm-seg-fill gm-f${i}`} style={{ width: `${sg.preenche * 100}%` }} />
            <span>{sg.rotulo}</span>
          </div>
        ))}
      </div>
      <div className="gm-ticks" aria-hidden="true">
        {metas.map((m, i) => (
          <span key={m.nome} style={{ left: `${larg0 + i * largM}%` }}>
            {m.nome.replace('Meta ', '')}
            <br />
            <i>{reais(m.valor)}</i>
          </span>
        ))}
      </div>
      {legenda && <p className="gm-onde"><span className="gm-onde-p" aria-hidden="true" /><span className="gm-onde-t">{onde}</span></p>}
    </div>
  );
}

/* ---------- componente principal ---------- */

export function GuiaMetas({
  config = CONFIG_PADRAO,
  faturamentoInicial = 36000,
  diasMesInicial = 30,
  diasFolguistaInicial = 5,
  pessoasFixasInicial = 2,
  onChange,
  className,
}: GuiaMetasProps) {
  const idFat = useId();
  const [faturamento, setFaturamento] = useState(faturamentoInicial);
  const [diasMes, setDiasMes] = useState(diasMesInicial);
  const [diasFolguista, setDiasFolguista] = useState(diasFolguistaInicial);
  const [pessoasFixas, setPessoasFixas] = useState(pessoasFixasInicial);

  const r = useMemo(
    () => calcularBonificacao({ faturamento, diasMes, diasFolguista, pessoasFixas }, config),
    [faturamento, diasMes, diasFolguista, pessoasFixas, config],
  );
  useEffect(() => {
    onChange?.({ faturamento, diasMes, diasFolguista, pessoasFixas }, r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r]);

  const metas = r.metas;
  const M = metas.length;
  const topo = M ? metas[M - 1].valor : 0;
  const primeira = metas[0];
  const temPremio = r.premioEquipe > 0;
  const maxRange = Math.max(Math.ceil((topo * 1.4) / 1000) * 1000, Math.ceil(faturamento / 1000) * 1000, 1000);
  const premiacaoIgual = metas.every((m) => metas[0] && m.premiacaoConfig === metas[0].premiacaoConfig);
  const idxBandeira = Math.max(0, r.metasAtingidas - 1);
  const dFolg = r.diasFolguista;
  const total = 11 + M;
  const p = { meta: (i: number) => 4 + i, cuidado: 4 + M, soma: 5 + M, lider: 6 + M, folg: 7 + M, dias: 8 + M, fixas: 9 + M, result: 10 + M, consultar: 11 + M };
  const ir = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const premiacaoUnica = primeira ? primeira.premiacaoConfig : 0;
  const somaPremiacoes = metas.filter((m) => m.atingida).reduce((s, m) => s + m.premiacao, 0);
  const atual: ResultadoMeta | undefined = r.metasAtingidas > 0 ? metas[r.metasAtingidas - 1] : undefined;

  const atalhos = [
    ...metas.map((m) => ({ rotulo: m.nome, valor: m.valor })),
    { rotulo: 'Zerar', valor: 0 },
  ];

  const partesBarra = [
    ...Array.from({ length: r.pessoasFixas }, (_, i) => ({ chave: `f${i}`, rotulo: `fixa ${i + 1}`, valor: r.porFixa, cls: i % 2 ? 'gm-b-roxo2' : 'gm-b-roxo' })),
    { chave: 'g', rotulo: 'folguista', valor: r.folguista, cls: 'gm-b-azul' },
    { chave: 'l', rotulo: 'liderança', valor: r.adicionalLideranca, cls: 'gm-b-laranja' },
  ].filter((x) => x.valor > 0);

  const atalhosNode = (
    <div className="gm-atalhos" role="group" aria-label="Escolher um valor pronto">
      {atalhos.map((a) => (
        <button key={a.rotulo} type="button" className={a.valor > 0 && faturamento >= a.valor ? 'on' : ''} onClick={() => setFaturamento(a.valor)}>
          {a.rotulo}
          {a.valor > 0 && <small>{reais(a.valor)}</small>}
        </button>
      ))}
    </div>
  );
  const contadoresNode = (
    <div className="gm-contadores">
      <Contador rotulo="Dias do mês" valor={diasMes} min={28} max={31} sufixo="dias" onChange={(v) => { setDiasMes(v); if (diasFolguista > v) setDiasFolguista(v); }} />
      <Contador rotulo="Dias da folguista" valor={dFolg} min={0} max={diasMes} sufixo="dias" onChange={setDiasFolguista} />
      <Contador rotulo="Pessoas fixas" valor={pessoasFixas} min={0} max={12} sufixo={pessoasFixas === 1 ? 'pessoa' : 'pessoas'} onChange={setPessoasFixas} />
    </div>
  );

  const linhaConsulta = (valor: number) => {
    const x = calcularBonificacao({ faturamento: valor, diasMes: 30, diasFolguista: 0, pessoasFixas: 0 }, config);
    return { premio: x.premioEquipe, lider: x.adicionalLideranca };
  };
  const linhas = [
    ...metas.map((m) => ({ rotulo: `${reais(m.valor)} (${m.nome})`, ...linhaConsulta(m.valor), destaque: false })),
    { rotulo: `Nossa loja: ${reais(faturamento)}`, ...linhaConsulta(faturamento), destaque: true },
    { rotulo: reais(topo + 3000), ...linhaConsulta(topo + 3000), destaque: false },
  ];

  return (
    <div className={`gm-root gm-ds ${className ?? ''}`}>
      <style>{CSS}</style>

      {/* barra fixa: escolher o faturamento */}
      <div className="gm-fixa">
        <div className="gm-fixa-l">
          <label htmlFor={idFat}>Vendas no mês</label>
          <div className="gm-campo">
            <span>R$</span>
            <input
              id={idFat}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={faturamento === 0 ? '' : faturamento.toLocaleString('pt-BR')}
              onChange={(e) => setFaturamento(Math.min(9_999_999, Number(e.target.value.replace(/\D/g, '')) || 0))}
            />
          </div>
        </div>
        <div className="gm-fixa-r">
          <div><small>Prêmio da equipe</small><Pulso valor={reais(r.premioEquipe)} /></div>
          <div className="gm-fixa-lid"><small>Adicional liderança</small><Pulso valor={reais(r.adicionalLideranca)} /></div>
        </div>
        <input
          className="gm-range"
          type="range"
          min={0}
          max={maxRange}
          step={500}
          value={Math.min(faturamento, maxRange)}
          aria-label="Arraste para escolher o faturamento"
          style={{ ['--p' as string]: `${(Math.min(faturamento, maxRange) / maxRange) * 100}%` }}
          onChange={(e) => setFaturamento(Number(e.target.value))}
        />
        <div className="gm-fixa-ctrl">{atalhosNode}{contadoresNode}</div>
      </div>

      {/* ============ PÁGINA 1 ============ */}
      <Pagina n={1} total={total} id="gm-p1">
        <div className="gm-cols"><div className="gm-col">
        <h1 className="gm-h1">Como calcular a bonificação da equipe</h1>
        <p className="gm-lead">Um guia simples, com um exemplo só, do começo ao fim. Mude o valor na barra de cima e veja tudo se refazer.</p>

        <div className="gm-exemplo">
          <span className="gm-exemplo-t">SIMULAÇÃO</span>
          <p className="gm-exemplo-p">A loja vendeu <Pulso valor={reais(faturamento)} /> no mês</p>
        </div>
        </div><div className="gm-col">

        <h2 className="gm-h2-solto">O caminho da conta</h2>
        <ol className="gm-caminho">
          {[
            { cor: 'rosa', t: 'As vendas formam o prêmio da equipe', d: 'É a soma da premiação e do extra de cada meta.', v: r.premioEquipe, id: 'gm-p2' },
            { cor: 'laranja', t: 'A liderança ganha um adicional', d: 'É pago por fora, sem tirar nada do prêmio da equipe.', v: r.adicionalLideranca, id: `gm-p${p.lider}` },
            { cor: 'azul', t: 'A folguista pega a parte dela', d: 'Ela recebe de acordo com os dias que trabalhou.', v: r.folguista, id: `gm-p${p.folg}` },
            { cor: 'roxo', t: 'As pessoas fixas dividem o que sobrou', d: 'O resto é dividido em partes iguais.', v: r.porFixa, id: `gm-p${p.fixas}` },
          ].map((s, i) => (
            <li key={i} className={`gm-passo gm-${s.cor}`}>
              <button type="button" onClick={() => ir(s.id)}>
                <span className="gm-num">{i + 1}</span>
                <span className="gm-passo-txt"><b>{s.t}</b><small>{s.d}</small></span>
                <span className="gm-passo-v">{temPremio ? <Pulso valor={reais(s.v)} /> : <em>—</em>}{i === 3 && temPremio && r.pessoasFixas > 1 && <small>cada</small>}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="gm-nota">Os valores deste guia são ilustrativos, para ensinar a conta. Cada quiosque usa os valores da sua própria meta.</p>
        </div></div>
      </Pagina>

      {/* ============ PÁGINA 2: degraus ============ */}
      <Pagina n={2} total={total} id="gm-p2">
        <Titulo n={1}>As metas são como degraus</Titulo>
        <p className="gm-txt">Quanto mais a loja vende, mais degraus ela sobe. Cada meta alcançada dá {premiacaoIgual ? <>uma premiação de <b>{reais(premiacaoUnica)}</b></> : 'uma premiação'} para a equipe.</p>
        <div className="gm-cols"><div className="gm-col">
        <div className="gm-escada" role="img" aria-label={`A loja alcançou ${r.metasAtingidas} de ${M} metas`}>
          {metas.map((m, i) => (
            <div key={m.nome} className={`gm-deg ${m.atingida ? 'on' : ''}`}>
              <div className="gm-deg-topo">
                {i === idxBandeira && (
                  <div className={`gm-bandeira ${r.metasAtingidas === 0 ? 'gm-chao' : ''}`}>
                    <Bandeira />
                    <span>Nossa loja: {reais(faturamento)}</span>
                  </div>
                )}
                {m.atingida && <span className="gm-premio-tag">premiação {reais(m.premiacao)}</span>}
              </div>
              <div className="gm-deg-bloco" style={{ ['--h' as string]: `${64 + i * 40}px` }}>
                <small>{m.nome.toUpperCase()}</small>
                <b>{reais(m.valor)}</b>
                <i>{m.atingida ? '✓ alcançada' : `faltam ${reais(m.faltam)}`}</i>
              </div>
            </div>
          ))}
        </div>
        </div><div className="gm-col">

        <Caixa titulo="Nesta simulação">
          {r.metasAtingidas === M ? (
            <p>A loja vendeu {reais(faturamento)}. Passou da última meta, então alcançou as {M} metas.</p>
          ) : r.metasAtingidas > 0 ? (
            <p>A loja vendeu {reais(faturamento)}. Alcançou {r.metasAtingidas} de {M} metas. Faltam {reais(r.proximaMeta?.faltam ?? 0)} para a {r.proximaMeta?.nome}.</p>
          ) : (
            <p>A loja vendeu {reais(faturamento)}. Ainda não alcançou nenhuma meta. Faltam {reais(primeira?.faltam ?? 0)} para a {primeira?.nome}.</p>
          )}
          {premiacaoIgual ? (
            <Conta itens={[`${r.metasAtingidas} ${r.metasAtingidas === 1 ? 'meta' : 'metas'}`, '×', reais(premiacaoUnica), '=', { v: reais(somaPremiacoes), s: 'premiação das metas', res: true }]} />
          ) : (
            <Conta itens={[{ v: reais(somaPremiacoes), s: 'premiação das metas', res: true }]} />
          )}
        </Caixa>
        <p className="gm-nota">Se a loja vender menos que {reais(primeira?.valor ?? 0)}, ainda não alcançou nenhuma meta e não tem prêmio. Além da premiação, cada meta rende um extra, calculado em porcentagem. É o que vem a seguir.</p>
        </div></div>
      </Pagina>

      {/* ============ PÁGINA 3: extra em % ============ */}
      <Pagina n={3} total={total} id="gm-p3">
        <Titulo n={1}>O extra é uma porcentagem das vendas</Titulo>
        <p className="gm-txt">Depois da premiação, a equipe ganha um extra sobre as vendas que passam de cada meta. A porcentagem cresce a cada meta:</p>
        <div className="gm-tres">
          {metas.map((m, i) => (
            <div key={m.nome} className={`gm-tres-c ${m.atingida ? 'ok' : ''}`}>
              <small>Extra da {m.nome}</small>
              <b>{m.percentual}%</b>
              <span>{m.fim === null ? <>das vendas acima de {reais(m.valor)}</> : <>das vendas de {reais(m.valor)} até {reais(m.fim)}</>}</span>
            </div>
          ))}
        </div>
        <h3 className="gm-h3">As vendas da nossa loja, em pedaços</h3>
        <Regua r={r} legenda />
        <p className="gm-nota">Desenho fora de escala. Cada porcentagem vale só para o seu pedaço das vendas.</p>
        <div className="gm-cols"><div className="gm-col">
        <Caixa titulo={`O que é ${primeira?.percentual}%?`}>
          <p>Porcentagem é uma parte de cada 100. {primeira?.percentual}% quer dizer {primeira?.percentual} de cada 100. Na calculadora: valor × {primeira?.percentual} ÷ 100.</p>
        </Caixa>
        </div><div className="gm-col">
        <Caixa titulo="Os 3 passos de cada extra" cor="azul">
          <ol className="gm-lista">
            <li>Achar o pedaço das vendas daquela meta.</li>
            <li>Subtrair para saber quanto a loja vendeu nesse pedaço.</li>
            <li>Calcular a porcentagem desse valor.</li>
          </ol>
        </Caixa>
        </div></div>
      </Pagina>

      {/* ============ PÁGINAS DE CADA META ============ */}
      {metas.map((m, i) => {
        const prox = metas[i + 1];
        const limiteNome = m.pedacoCompleto && prox ? prox.nome : 'nossa loja';
        const limiteValor = m.inicio + m.vendidoNoPedaco;
        return (
          <Pagina key={m.nome} n={p.meta(i)} total={total} id={`gm-p${p.meta(i)}`}>
            <Titulo n={1}>{m.nome}: premiação e extra de {m.percentual}%</Titulo>
            <Regua r={r} destaque={i + 1} />
            {!m.atingida ? (
              <>
                <Trava>Esta página ganha números quando a loja alcançar a {m.nome}. Faltam <b>{reais(m.faltam)}</b>.</Trava>
                <p className="gm-txt">Ao alcançar a {m.nome}, a equipe ganha <b>{reais(m.premiacaoConfig)}</b> de premiação e <b>{m.percentual}% de extra</b> {m.fim === null ? <>sobre tudo o que a loja vender acima de {reais(m.valor)}</> : <>sobre o que a loja vender de {reais(m.valor)} até {reais(m.fim)}</>}.</p>
              </>
            ) : (
              <>
                <p className="gm-vendido"><Pulso valor={reais(m.vendidoNoPedaco)} /> vendidos nesse pedaço</p>
                <p className="gm-txt"><b>Premiação da meta:</b> ao alcançar a {m.nome}, a equipe ganha <b>{reais(m.premiacao)}</b>.</p>
                <h3 className="gm-h3">Extra de {m.percentual}%, em 3 passos</h3>

                <div className="gm-passos3">
                <div className="gm-ms"><span className="gm-mn">1</span><div>
                  <b>Qual é o pedaço das vendas?</b>
                  <p>{m.fim === null
                    ? <>O pedaço do {m.percentual}% começa na {m.nome} ({reais(m.inicio)}) e não tem fim: vale tudo o que a loja vender acima disso.</>
                    : <>O pedaço do {m.percentual}% começa na {m.nome} ({reais(m.inicio)}) e vai até a {prox?.nome} ({reais(m.fim)}).</>}</p>
                </div></div>

                <div className="gm-ms"><span className="gm-mn">2</span><div>
                  <b>Quanto a loja vendeu nesse pedaço?</b>
                  <Conta itens={[{ v: reais(limiteValor), s: limiteNome }, '−', { v: reais(m.inicio), s: m.nome }, '=', { v: reais(m.vendidoNoPedaco), s: 'no pedaço', res: true }]} />
                  <p className="gm-peq">{m.fim === null
                    ? <>A loja vendeu {reais(faturamento)}, ou seja, {reais(m.vendidoNoPedaco)} acima da {m.nome}. Se vendesse mais, esse valor seria maior.</>
                    : m.pedacoCompleto
                      ? <>A loja vendeu {reais(faturamento)} e passou da {prox?.nome}. Então vendeu o pedaço inteiro: {reais(m.vendidoNoPedaco)} entre uma meta e outra.</>
                      : <>A loja vendeu {reais(faturamento)} e ainda está dentro deste pedaço: faltam {reais(m.fim - faturamento)} para completá-lo.</>}</p>
                </div></div>

                <div className="gm-ms"><span className="gm-mn">3</span><div>
                  <b>Quanto é {m.percentual}% de {reais(m.vendidoNoPedaco)}?</b>
                  <Conta itens={[reais(m.vendidoNoPedaco), '×', String(m.percentual), '÷', '100', '=', { v: reais(m.extra), s: 'extra', res: true }]} />
                  <p className="gm-peq">Na calculadora: {num(m.vendidoNoPedaco)} × {m.percentual} ÷ 100 = {num(m.extra)}</p>
                </div></div>
                </div>

                <div className="gm-gera">
                  <div><small>{m.nome} gera para a equipe</small><span>{reais(m.premiacao)} de premiação + {reais(m.extra)} de extra</span></div>
                  <Pulso valor={reais(m.total)} />
                </div>
              </>
            )}
          </Pagina>
        );
      })}

      {/* ============ CUIDADO ============ */}
      <Pagina n={p.cuidado} total={total} id={`gm-p${p.cuidado}`}>
        <Titulo n={1}>Cuidado: cada porcentagem vale só para o seu pedaço</Titulo>
        <p className="gm-txt">O erro mais comum é aplicar a porcentagem maior em todas as vendas. Não pode.</p>
        {atual ? (
          <div className="gm-cc">
            <div className="gm-errado">
              <b>✕ Errado</b>
              <span>Aplicar os {atual.percentual}% em todas as vendas.</span>
              <em>{atual.percentual}% de {reais(faturamento)} =</em>
              <strong>{reais((faturamento * atual.percentual) / 100)}</strong>
              <small>Conta errada.</small>
            </div>
            <div className="gm-certo">
              <b>✓ Certo</b>
              <span>Os {atual.percentual}% valem só para o seu pedaço.</span>
              <em>{atual.percentual}% só de {reais(atual.vendidoNoPedaco)} =</em>
              <strong>{reais(atual.extra)}</strong>
              <small>Conta certa.</small>
            </div>
          </div>
        ) : (
          <Trava>O exemplo do erro aparece quando a loja alcançar a {primeira?.nome}.</Trava>
        )}
        <Caixa titulo="Para guardar" cor="azul">
          <p>Pense em cada pedaço das vendas como uma sala diferente. {metas.map((m, i) => <span key={m.nome}>O {m.percentual}% só vale na sala do {m.percentual}%{i < M - 1 ? '. ' : '.'}</span>)}</p>
        </Caixa>
      </Pagina>

      {/* ============ SOMANDO ============ */}
      <Pagina n={p.soma} total={total} id={`gm-p${p.soma}`}>
        <Titulo n={1}>Somando: o prêmio da equipe</Titulo>
        <p className="gm-txt">Agora juntamos o que cada meta gerou.</p>
        <div className="gm-cols"><div className="gm-col">
        <div className="gm-somas">
          {metas.map((m) => (
            <div key={m.nome} className={`gm-soma-l ${m.atingida ? '' : 'off'}`}>
              <span className="gm-soma-rs">R$</span>
              <div>
                <b>{m.nome}</b>
                <small>{m.atingida ? <>{reais(m.premiacao)} de premiação + {reais(m.extra)} de extra ({m.percentual}% de {reais(m.vendidoNoPedaco)})</> : 'ainda não alcançada'}</small>
              </div>
              <Pulso valor={m.atingida ? reais(m.total) : '—'} />
            </div>
          ))}
        </div>
        </div><div className="gm-col">
        <div className="gm-soma-total">
          <div><small>PRÊMIO DA EQUIPE</small><span>{temPremio ? metas.filter((m) => m.atingida).map((m) => reais(m.total)).join(' + ') : 'nenhuma meta alcançada'}</span></div>
          <Pulso valor={reais(r.premioEquipe)} />
        </div>
        <Caixa titulo="O que vem agora">
          <p>{temPremio ? <>Esses {reais(r.premioEquipe)} são o prêmio da equipe. Nas próximas páginas, vamos ver quanto fica com cada pessoa.</> : 'Sem prêmio da equipe, não há o que dividir. Aumente o valor das vendas na barra de cima.'}</p>
        </Caixa>
        </div></div>
      </Pagina>

      {/* ============ LIDERANÇA ============ */}
      <Pagina n={p.lider} total={total} id={`gm-p${p.lider}`}>
        <Titulo n={2} cor="laranja">O adicional da liderança</Titulo>
        <p className="gm-txt">A liderança ganha 1 parte de um prêmio cortado em {config.divisorLideranca} partes iguais. É um terço do prêmio da equipe.</p>
        <div className="gm-cols"><div className="gm-col">
        {temPremio ? (
          <>
            <p className="gm-txt">O prêmio da equipe é de {reais(r.premioEquipe)}. Cortando em {config.divisorLideranca} partes iguais:</p>
            <div className="gm-partes" aria-hidden="true">
              {Array.from({ length: Math.max(1, Math.round(config.divisorLideranca)) }, (_, i) => {
                const ult = i === Math.max(1, Math.round(config.divisorLideranca)) - 1;
                return (
                  <div key={i} className={ult ? 'x' : ''}>
                    <b>{reais(r.premioEquipe / config.divisorLideranca)}</b>
                    <small>{ult ? 'parte da liderança' : `parte ${i + 1}`}</small>
                  </div>
                );
              })}
            </div>
            <Conta cor="laranja" itens={[{ v: reais(r.premioEquipe) }, '÷', String(config.divisorLideranca), '=', { v: reais(r.adicionalLideranca), s: 'adicional da liderança', res: true }]} />
          </>
        ) : (
          <Trava>Esta página ganha números quando a loja alcançar a {primeira?.nome}.</Trava>
        )}
        </div><div className="gm-col">
        <Caixa titulo="Três coisas importantes" cor="laranja">
          <ol className="gm-lista">
            <li>É um adicional por fora. A equipe continua com o prêmio inteiro{temPremio ? <> ({reais(r.premioEquipe)})</> : ''}.</li>
            <li>O número {config.divisorLideranca} é sempre {config.divisorLideranca}, mesmo que a equipe tenha 2, 4 ou 6 pessoas.</li>
            <li>A conta usa o prêmio completo, antes de separar a parte da folguista.</li>
          </ol>
        </Caixa>
        </div></div>
      </Pagina>

      {/* ============ FOLGUISTA ============ */}
      <Pagina n={p.folg} total={total} id={`gm-p${p.folg}`}>
        <Titulo n={3} cor="azul">A parte da folguista</Titulo>
        <p className="gm-txt">A folguista recebe de acordo com os dias que trabalhou no mês.</p>
        <div className="gm-contadores">
          <Contador rotulo="Dias do mês" valor={diasMes} min={28} max={31} sufixo="dias" onChange={(v) => { setDiasMes(v); if (diasFolguista > v) setDiasFolguista(v); }} />
          <Contador rotulo="Dias da folguista" valor={dFolg} min={0} max={diasMes} sufixo="dias" onChange={setDiasFolguista} />
        </div>
        {temPremio ? (
          <div className="gm-cols"><div className="gm-col">
            <h3 className="gm-h3">Passo A: cada dia do mês vale um pedaço igual</h3>
            <p className="gm-txt">O mês tem {r.diasMes} dias. Então o prêmio de {reais(r.premioEquipe)} é cortado em {r.diasMes} pedaços iguais.</p>
            <Conta cor="azul" itens={[{ v: reais(r.premioEquipe) }, '÷', `${r.diasMes} dias`, '=', { v: reais(r.valorPorDia), s: 'aprox. por dia', res: true }]} />
            </div><div className="gm-col">
            <h3 className="gm-h3">Passo B: ela leva os dias em que trabalhou</h3>
            <p className="gm-txt">A folguista trabalhou em {dFolg} {dFolg === 1 ? 'dia' : 'dias'} (em azul).</p>
            <div className="gm-cal" style={{ ['--cols' as string]: 10 }} aria-hidden="true">
              {Array.from({ length: r.diasMes }, (_, i) => (
                <i key={i} className={i < dFolg ? 'on' : ''}>{i + 1}</i>
              ))}
            </div>
            <Conta cor="azul" itens={[`${dFolg} / ${r.diasMes} dias`, '×', reais(r.premioEquipe), '=', { v: reais(r.folguista), s: 'folguista recebe', res: true }]} />
            {Math.abs(r.valorPorDia * dFolg - r.folguista) >= 0.005 && <p className="gm-nota">O valor de cada dia foi arredondado no centavo; o total da folguista é calculado sem esse arredondamento.</p>}
          </div></div>
        ) : (
          <Trava>Esta página ganha números quando a loja alcançar a {primeira?.nome}.</Trava>
        )}
        <p className="gm-nota">Se o mês da meta tiver 31 dias, o prêmio é cortado em 31 pedaços. O número de pedaços é sempre o total de dias do mês, mesmo nos dias em que o quiosque não tem turno.</p>
      </Pagina>

      {/* ============ QUAIS DIAS CONTAM ============ */}
      <Pagina n={p.dias} total={total} id={`gm-p${p.dias}`}>
        <Titulo n={3} cor="azul">Quais dias contam para a folguista?</Titulo>
        <p className="gm-txt">O sistema olha a escala publicada. Cada data conta só uma vez.</p>
        <div className="gm-cols"><div className="gm-col">
        <div className="gm-dias">
          {[
            { ok: true, a: 'Tem um turno na data.', b: 'Conta 1 dia' },
            { ok: true, a: 'Tem dois turnos na mesma data.', b: 'Conta só 1 dia' },
            { ok: false, a: 'Faltou e perdeu o único turno daquela data.', b: 'Esse dia não conta' },
            { ok: true, a: 'Perdeu um turno, mas ainda tem outro na mesma data.', b: 'O dia continua contando' },
            { ok: true, a: 'Uma correção aprovada devolveu o turno.', b: 'O dia volta a contar' },
          ].map((l, i) => (
            <div key={i} className={l.ok ? 'ok' : 'nao'}>
              <span>{l.ok ? '✓' : '✕'}</span>
              <p>{l.a}</p>
              <b>{l.b}</b>
            </div>
          ))}
        </div>
        </div><div className="gm-col">
        <Caixa titulo="Dois números diferentes" cor="azul">
          <p><b>Dias da folguista:</b> só as datas em que ela tem turno. No exemplo, {dFolg}.</p>
          <p><b>Dias do mês:</b> todos os dias do calendário. No exemplo, {r.diasMes}.</p>
        </Caixa>
        </div></div>
      </Pagina>

      {/* ============ FIXAS ============ */}
      <Pagina n={p.fixas} total={total} id={`gm-p${p.fixas}`}>
        <Titulo n={4} cor="roxo">As pessoas fixas dividem o que sobrou</Titulo>
        <p className="gm-txt">Primeiro tiramos a parte da folguista. O que sobra é dividido em partes iguais.</p>
        <div className="gm-contadores">
          <Contador rotulo="Pessoas fixas" valor={pessoasFixas} min={0} max={12} sufixo={pessoasFixas === 1 ? 'pessoa' : 'pessoas'} onChange={setPessoasFixas} />
        </div>
        <div className="gm-cols"><div className="gm-col">
        {temPremio ? (
          <>
            <h3 className="gm-h3">Passo A: quanto sobrou?</h3>
            <Conta cor="roxo" itens={[{ v: reais(r.premioEquipe), s: 'prêmio da equipe' }, '−', { v: reais(r.folguista), s: 'folguista' }, '=', { v: reais(r.sobra), s: 'sobrou', res: true }]} />
            <h3 className="gm-h3">Passo B: dividir entre {r.pessoasFixas === 1 ? 'a pessoa fixa' : `as ${r.pessoasFixas} pessoas fixas`}</h3>
            {r.pessoasFixas > 0 ? (
              <>
                <Conta cor="roxo" itens={[reais(r.sobra), '÷', `${r.pessoasFixas} ${r.pessoasFixas === 1 ? 'pessoa' : 'pessoas'}`, '=', { v: reais(r.porFixa), s: 'cada pessoa fixa', res: true }]} />
                <div className="gm-fixas-t">
                  {Array.from({ length: r.pessoasFixas }, (_, i) => (
                    <div key={i}><b>{reais(r.porFixa)}</b><small>pessoa fixa {i + 1}</small></div>
                  ))}
                </div>
              </>
            ) : (
              <p className="gm-vazio">Sem pessoas fixas, não há como dividir o restante.</p>
            )}
          </>
        ) : (
          <Trava>Esta página ganha números quando a loja alcançar a {primeira?.nome}.</Trava>
        )}
        </div><div className="gm-col">
        <Caixa titulo="Atenção à ordem" cor="roxo">
          <p>As pessoas fixas dividem {temPremio ? reais(r.sobra) : 'o que sobrou'}, o que sobrou depois da folguista. Já o adicional da liderança foi calculado em cima dos {temPremio ? reais(r.premioEquipe) : 'valor'} inteiros.</p>
        </Caixa>
        </div></div>
      </Pagina>

      {/* ============ RESULTADO ============ */}
      <Pagina n={p.result} total={total} id={`gm-p${p.result}`}>
        <h2 className="gm-h2-solto">Resultado: quem recebe quanto</h2>
        <p className="gm-txt">Loja que vendeu {reais(faturamento)}, mês de {r.diasMes} dias, folguista com {dFolg} {dFolg === 1 ? 'dia' : 'dias'} e {r.pessoasFixas} {r.pessoasFixas === 1 ? 'pessoa fixa' : 'pessoas fixas'}.</p>
        {temPremio ? (
          <>
            <div className="gm-barra" role="img" aria-label="Divisão do total pago pela loja">
              {partesBarra.map((x) => (
                <div key={x.chave} className={x.cls} style={{ flexGrow: x.valor, flexBasis: 0 }}>
                  <b>{reais(x.valor)}</b>
                  <small>{x.rotulo}</small>
                </div>
              ))}
            </div>
            <p className="gm-nota">As três primeiras partes juntas formam o prêmio da equipe: {reais(r.premioEquipe)}. A parte laranja é o adicional da liderança, pago por fora.</p>
            <div className="gm-cols"><div className="gm-col">
            <table className="gm-tabela">
              <thead><tr><th>Quem recebe</th><th>Como chegamos</th><th>Recebe</th></tr></thead>
              <tbody>
                <tr><td className="gm-c-azul">Folguista</td><td>{dFolg} / {r.diasMes} dias × {reais(r.premioEquipe)}</td><td><b>{reais(r.folguista)}</b></td></tr>
                {r.pessoasFixas > 0 ? Array.from({ length: r.pessoasFixas }, (_, i) => (
                  <tr key={i}><td className="gm-c-roxo">Pessoa fixa {i + 1}</td><td>{reais(r.sobra)} ÷ {r.pessoasFixas}</td><td><b>{reais(r.porFixa)}</b></td></tr>
                )) : (
                  <tr><td className="gm-c-roxo">Pessoas fixas</td><td>nenhuma informada</td><td><b>{reais(0)}</b></td></tr>
                )}
                <tr><td className="gm-c-laranja">Liderança (adicional)</td><td>{reais(r.premioEquipe)} ÷ {config.divisorLideranca}</td><td><b>{reais(r.adicionalLideranca)}</b></td></tr>
                <tr className="gm-total"><td colSpan={2}>Total pago pela loja</td><td><Pulso valor={reais(r.totalPago)} /></td></tr>
              </tbody>
            </table>
            </div><div className="gm-col">
            <Caixa titulo="Conferindo">
              <p>{reais(r.folguista)} + {r.pessoasFixas} × {reais(r.porFixa)} + {reais(r.adicionalLideranca)} = {reais(r.folguista + r.porFixa * r.pessoasFixas + r.adicionalLideranca)}. É o prêmio da equipe ({reais(r.premioEquipe)}) mais o adicional da liderança ({reais(r.adicionalLideranca)}).
                {r.pessoasFixas > 0 && Math.abs(r.diferencaArredondamento) >= 0.005 && <> Diferença de {reais(Math.abs(r.diferencaArredondamento), { sempreDuasCasas: true })} por arredondamento dos centavos.</>}
                {r.pessoasFixas === 0 && r.sobra > 0 && <> Sem pessoas fixas, {reais(r.sobra)} do prêmio ficam sem destino.</>}</p>
            </Caixa>
            </div></div>
          </>
        ) : (
          <Trava>O resultado aparece quando a loja alcançar a {primeira?.nome}.</Trava>
        )}
      </Pagina>

      {/* ============ CONSULTAR ============ */}
      <Pagina n={p.consultar} total={total} id={`gm-p${p.consultar}`}>
        <h2 className="gm-h2-solto">Para consultar</h2>
        <p className="gm-txt">Quanto a loja gera em cada nível de vendas, e as dúvidas mais comuns.</p>
        <div className="gm-cols"><div className="gm-col">
        <table className="gm-tabela gm-tabela-c">
          <thead><tr><th>Vendas no mês</th><th>Prêmio da equipe</th><th>Adicional da liderança</th></tr></thead>
          <tbody>
            <tr><td>Menos de {reais(primeira?.valor ?? 0)}</td><td>sem prêmio</td><td>sem adicional</td></tr>
            {linhas.map((l, i) => (
              <tr key={i} className={l.destaque ? 'gm-destaque' : ''}><td>{l.rotulo}</td><td>{l.premio > 0 ? reais(l.premio) : 'sem prêmio'}</td><td>{l.lider > 0 ? reais(l.lider) : 'sem adicional'}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="gm-nota">Acima de {reais(topo)} não tem limite: a equipe segue ganhando {metas[M - 1]?.percentual}% sobre o que vender acima desse valor.</p>
        </div><div className="gm-col">
        <h3 className="gm-h3">Dúvidas comuns</h3>
        <div className="gm-faq">
          {[
            [`Os ${metas[M - 1]?.percentual}% valem para todas as vendas do mês?`, `Não. Valem só para o que passar de ${reais(topo)}.`],
            [`Vendemos menos de ${reais(primeira?.valor ?? 0)}. Tem prêmio?`, `Não. O prêmio começa na ${primeira?.nome}.`],
            [`A premiação de ${reais(premiacaoUnica)} é para cada pessoa?`, 'Não. É uma vez por meta, para a equipe toda.'],
            ['O adicional da liderança diminui o meu prêmio?', 'Não. Ele é pago por fora.'],
            ['Fiz dois turnos no mesmo dia. Conta 2 dias?', 'Não. Cada data conta uma vez só.'],
            ['Os valores da minha loja são esses?', 'Não necessariamente. Cada quiosque usa os valores da sua meta.'],
          ].map(([q, a]) => (
            <div key={q}><b>{q}</b><span>{a}</span></div>
          ))}
        </div>
        </div></div>
      </Pagina>
    </div>
  );
}

export default GuiaMetas;

/* ---------- estilos embutidos ---------- */

const CSS = `
.gm-root{--rosa:#d9347f;--rosa2:#ec5f9f;--rosa3:#f6a9cb;--rosa-c:#fdeaf3;--azul:#1f8fb3;--azul-c:#e2f4f9;--roxo:#8a5bb0;--roxo2:#a47bc7;--roxo-c:#f1e9f7;--laranja:#dc7a12;--laranja-c:#fff1dc;--tinta:#2b2433;--cinza:#6b6275;--linha:#eadfe6;--erro:#b43b3b;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--tinta);max-width:760px;margin:0 auto;padding:12px 14px 96px;line-height:1.45;font-size:16px;box-sizing:border-box}
.gm-root *,.gm-root *::before,.gm-root *::after{box-sizing:border-box}
.gm-topo{padding:6px 2px 14px}
.gm-h1{font-size:clamp(26px,5vw,34px);line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}
.gm-lead{margin:0;color:var(--cinza);font-size:17px}
.gm-card{background:#fff;border:1px solid var(--linha);border-radius:20px;padding:18px;margin:0 0 16px;box-shadow:0 1px 2px rgba(43,36,51,.04)}
.gm-rotulo{display:block;font-weight:700;font-size:18px;margin-bottom:10px}
.gm-campo{display:flex;align-items:center;gap:10px;border:2px solid var(--rosa);border-radius:16px;padding:6px 16px;background:var(--rosa-c)}
.gm-campo span{font-size:26px;font-weight:800;color:var(--rosa)}
.gm-campo input{flex:1;min-width:0;border:0;background:transparent;font:800 clamp(34px,9vw,46px)/1.15 Inter,ui-sans-serif,system-ui,sans-serif;color:var(--tinta);outline:none;letter-spacing:-.02em}
.gm-campo:focus-within{box-shadow:0 0 0 4px rgba(217,52,127,.2)}
.gm-range{width:100%;margin:18px 0 6px;height:30px;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}
.gm-range::-webkit-slider-runnable-track{height:12px;border-radius:8px;background:linear-gradient(to right,var(--rosa) var(--p),#efe3ea var(--p))}
.gm-range::-moz-range-track{height:12px;border-radius:8px;background:#efe3ea}
.gm-range::-moz-range-progress{height:12px;border-radius:8px;background:var(--rosa)}
.gm-range::-webkit-slider-thumb{-webkit-appearance:none;width:30px;height:30px;border-radius:50%;background:#fff;border:4px solid var(--rosa);margin-top:-9px;box-shadow:0 2px 6px rgba(0,0,0,.18)}
.gm-range::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;border:4px solid var(--rosa)}
.gm-atalhos{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.gm-atalhos button{font:600 14px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;border:2px solid var(--linha);background:#fff;color:var(--tinta);border-radius:999px;padding:9px 14px;cursor:pointer;display:flex;flex-direction:column;align-items:center;min-height:44px;justify-content:center}
.gm-atalhos button small{font-size:12px;color:var(--cinza);font-weight:600}
.gm-atalhos button.on{border-color:var(--rosa);background:var(--rosa);color:#fff}.gm-atalhos button.on small{color:#ffd9ea}
.gm-atalhos button:hover{border-color:var(--rosa2)}
.gm-atalhos button:focus-visible,.gm-contador button:focus-visible,.gm-link:focus-visible,.gm-ajustes summary:focus-visible{outline:3px solid var(--azul);outline-offset:2px}
.gm-h2{display:flex;align-items:center;gap:12px;font-size:clamp(20px,4.6vw,24px);line-height:1.2;margin:0 0 10px;letter-spacing:-.01em}
.gm-h2-solto{margin-bottom:14px}
.gm-num{flex:none;width:36px;height:36px;border-radius:50%;background:var(--c,var(--rosa));color:#fff;font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center}
.gm-secao{--c:var(--rosa);background:#fff;border:1px solid var(--linha);border-top:6px solid var(--c);border-radius:20px;padding:18px;margin:0 0 16px}
.gm-secao.gm-laranja{--c:var(--laranja)}.gm-secao.gm-azul{--c:var(--azul)}.gm-secao.gm-roxo{--c:var(--roxo)}
.gm-txt{margin:0 0 12px;font-size:16.5px}.gm-txt-peq{margin:0 0 8px;font-size:15px;color:var(--cinza)}
.gm-nota{margin:6px 0 0;font-size:13.5px;color:var(--cinza)}
.gm-vazio{margin:6px 0 10px;color:var(--cinza);font-size:15px;background:#f7f2f5;border-radius:12px;padding:10px 12px}
.gm-aviso{color:var(--erro);font-weight:700;font-size:14px}
.gm-escada{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;align-items:end;margin-top:4px}
.gm-deg-topo{min-height:88px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;text-align:center}
.gm-deg-bloco{height:var(--h);border-radius:12px;background:#f0e6ee;color:#8b8196;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6px 4px;transition:background .35s,color .35s;border:2px dashed #dccfd8}
.gm-deg-bloco small{font-size:11.5px;font-weight:700;letter-spacing:.05em}.gm-deg-bloco b{font-size:clamp(15px,3.6vw,19px);font-weight:800}.gm-deg-bloco i{font-style:normal;font-size:12px;font-weight:600}
.gm-deg.on .gm-deg-bloco{border:2px solid transparent;color:#fff}
.gm-deg:nth-child(1).on .gm-deg-bloco{background:var(--rosa3);color:#6b1a45}
.gm-deg:nth-child(2).on .gm-deg-bloco{background:var(--rosa2)}
.gm-deg:nth-child(3).on .gm-deg-bloco{background:var(--rosa)}
.gm-deg:nth-child(n+4).on .gm-deg-bloco{background:var(--rosa)}
.gm-premio-tag{background:#f4b73f;color:#5f3d00;font-weight:800;font-size:12px;border-radius:999px;padding:3px 9px;animation:gm-sobe .4s ease-out}
.gm-bandeira{display:flex;flex-direction:column;align-items:center;gap:2px;font-weight:800;font-size:13px;animation:gm-sobe .4s ease-out}
.gm-bandeira span{background:var(--tinta);color:#fff;border-radius:8px;padding:3px 8px;font-size:12.5px}
.gm-chao{opacity:.75}
@keyframes gm-sobe{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}
.gm-status{margin-top:14px;background:var(--rosa-c);border-radius:14px;padding:12px 14px}
.gm-status p{margin:0 0 10px;font-size:16px}
.gm-prog{height:14px;border-radius:8px;background:#fff;overflow:hidden;border:1px solid var(--rosa3)}
.gm-prog div{height:100%;background:linear-gradient(90deg,var(--rosa3),var(--rosa));border-radius:8px;transition:width .35s}
.gm-prog-leg{display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;color:var(--cinza);margin-top:4px}
.gm-metas{display:grid;gap:14px;margin:6px 0 14px}
.gm-meta{border:1px solid var(--linha);border-radius:16px;padding:14px;background:#fff;transition:opacity .3s}
.gm-meta.off{background:#faf7f9;opacity:.8}
.gm-meta header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}
.gm-pilula{background:var(--rosa);color:#fff;font-weight:800;border-radius:999px;padding:4px 12px;font-size:14px}
.gm-meta.off .gm-pilula{background:#a89db0}
.gm-meta-valor{font-weight:800;font-size:17px}
.gm-estado{margin-left:auto;font-size:13.5px;font-weight:700;color:#1c8a55}.gm-meta.off .gm-estado{color:var(--cinza)}
.gm-linha{display:flex;justify-content:space-between;align-items:center;background:var(--rosa-c);border-radius:12px;padding:9px 12px;font-size:15px}
.gm-linha b{font-size:17px;color:var(--rosa)}
.gm-h3{font-size:16px;margin:14px 0 6px}
.gm-passo-t{margin:10px 0 6px;font-weight:700;font-size:15px}
.gm-meta footer{display:flex;justify-content:space-between;align-items:center;margin-top:14px;background:var(--rosa);color:#fff;border-radius:12px;padding:10px 14px;font-weight:700;font-size:15px}
.gm-meta.off footer{background:#a89db0}.gm-meta footer b{font-size:20px}
.gm-conta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:2px 0 4px}
.gm-tag{display:inline-flex;flex-direction:column;align-items:center;background:#fff;border:1.5px solid var(--linha);border-radius:12px;padding:6px 10px;font-weight:800;font-size:clamp(15px,3.8vw,18px);line-height:1.2;white-space:nowrap}
.gm-tag small{font-size:11px;font-weight:600;color:var(--cinza)}
.gm-op{font-size:20px;font-weight:700;color:var(--cinza)}
.gm-res{background:var(--c-res,var(--rosa));border-color:var(--c-res,var(--rosa));color:#fff}.gm-res small{color:rgba(255,255,255,.85)}
.gm-conta.gm-azul{--c-res:var(--azul)}.gm-conta.gm-roxo{--c-res:var(--roxo)}.gm-conta.gm-laranja{--c-res:var(--laranja)}
.gm-pulso{animation:gm-pulso .6s ease-out;display:inline-block}
@keyframes gm-pulso{0%{transform:scale(1.18);filter:brightness(1.15)}100%{transform:none;filter:none}}
.gm-soma{border-radius:16px;overflow:hidden;border:1px solid var(--linha)}
.gm-soma-linha{display:flex;justify-content:space-between;padding:10px 14px;font-size:16px;border-bottom:1px solid var(--linha);background:#fff}
.gm-soma-total{display:flex;justify-content:space-between;align-items:center;padding:14px;background:var(--rosa);color:#fff;font-weight:800;font-size:16px}.gm-soma-total b{font-size:26px}
.gm-partes{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:6px 0 12px}
.gm-partes div{background:#f1e2cf;color:#5d3b12;border-radius:14px;padding:16px 6px;text-align:center;display:flex;flex-direction:column;align-items:center}
.gm-partes div.x{background:var(--laranja);color:#fff}
.gm-partes b{font-size:clamp(16px,4.2vw,21px)}.gm-partes small{font-size:12px;font-weight:600}
.gm-contadores{display:flex;flex-wrap:wrap;gap:14px;margin:0 0 12px}
.gm-contador{display:flex;flex-direction:column;gap:6px}
.gm-contador-rotulo{font-weight:700;font-size:15px}
.gm-contador-ctrl{display:flex;align-items:center;gap:0;border:2px solid var(--linha);border-radius:14px;overflow:hidden;background:#fff}
.gm-contador-ctrl button{width:48px;height:48px;border:0;background:#f4eef2;font:800 24px/1 Inter,ui-sans-serif,system-ui,sans-serif;color:var(--tinta);cursor:pointer}
.gm-contador-ctrl button:disabled{opacity:.35;cursor:default}
.gm-contador-ctrl button:active:not(:disabled){background:#e9dce4}
.gm-contador-ctrl output{min-width:96px;text-align:center;font-size:17px}.gm-contador-ctrl output small{color:var(--cinza)}
.gm-cal{display:grid;grid-template-columns:repeat(var(--cols),1fr);gap:4px;margin:4px 0}
.gm-cal i{font-style:normal;height:clamp(26px,6.4vw,36px);border-radius:7px;background:#f0e9ee;color:#8b8196;font-size:clamp(11px,2.8vw,14px);font-weight:600;display:flex;align-items:center;justify-content:center;transition:background .25s,color .25s}
.gm-cal i.on{background:var(--azul);color:#fff;font-weight:800}
.gm-resultado{border-top:6px solid var(--rosa)}
.gm-barra{display:flex;border-radius:16px;overflow:hidden;min-height:78px;margin-bottom:14px}
.gm-barra>div{display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:8px 4px;min-width:0;transition:flex-grow .4s}
.gm-barra b{font-size:clamp(13px,3.4vw,19px)}.gm-barra small{font-size:12px;font-weight:600}
.gm-b-roxo{background:var(--roxo)}.gm-b-roxo2{background:var(--roxo2)}.gm-b-azul{background:var(--azul)}.gm-b-laranja{background:var(--laranja)}
.gm-tabela{width:100%;border-collapse:collapse;font-size:15px}
.gm-tabela th{background:var(--rosa);color:#fff;text-align:left;padding:10px 12px;font-size:13px}
.gm-tabela th:last-child,.gm-tabela td:last-child{text-align:right;white-space:nowrap}
.gm-tabela td{padding:11px 12px;border-bottom:1px solid var(--linha)}
.gm-tabela tbody tr:nth-child(even) td{background:#fbf3f7}
.gm-c-azul{color:var(--azul);font-weight:800}.gm-c-roxo{color:var(--roxo);font-weight:800}.gm-c-laranja{color:var(--laranja);font-weight:800}
.gm-total td{background:var(--laranja-c)!important;font-weight:800;font-size:17px}
.gm-ajustes summary{cursor:pointer;font-weight:700;font-size:16px}
.gm-ajustes-grade{display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:8px;align-items:center;margin:12px 0;font-size:13.5px}
.gm-ajustes-nome{font-weight:700;font-size:14px}
.gm-ajustes input[type=number]{width:100%;min-width:0;border:2px solid var(--linha);border-radius:10px;padding:8px;font:600 15px Inter,ui-sans-serif,system-ui,sans-serif}
.gm-ajustes-div{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14.5px}.gm-ajustes-div input{width:72px}
.gm-link{background:none;border:0;color:var(--azul);font:700 14.5px Inter,ui-sans-serif,system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:10px 0}
.gm-rodape-nota{text-align:center;font-size:13px;color:var(--cinza);margin:8px 0 0}
.gm-resumo{position:sticky;bottom:10px;z-index:5;display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:6px;background:var(--tinta);color:#fff;border-radius:18px;padding:10px 14px;margin-top:18px;box-shadow:0 8px 24px rgba(43,36,51,.28)}
.gm-resumo div{display:flex;flex-direction:column;min-width:0}.gm-resumo small{font-size:11px;font-weight:600;color:#d8cfe0}
.gm-resumo b{font-size:clamp(14px,3.8vw,19px);white-space:nowrap}.gm-resumo-l b{color:#ffb866}
@media (max-width:520px){.gm-card,.gm-secao{padding:14px;border-radius:16px}.gm-ajustes-grade{grid-template-columns:1fr 1fr 1fr}.gm-ajustes-grade>span:first-child{display:none}.gm-ajustes-nome{grid-column:1/-1;margin-top:6px}.gm-deg-topo{min-height:96px}}

.gm-regua{display:flex;border-radius:12px;overflow:hidden;border:1px solid var(--linha);height:46px}
.gm-seg{position:relative;background:#f3eaf0;display:flex;align-items:center;justify-content:center;min-width:0;border-right:2px solid #fff}
.gm-seg:last-child{border-right:0}
.gm-seg-fill{position:absolute;left:0;top:0;bottom:0;transition:width .4s}
.gm-f0{background:#d9cfdc}.gm-f1{background:var(--rosa3)}.gm-f2{background:var(--rosa2)}.gm-f3{background:var(--rosa)}.gm-f4{background:var(--rosa)}
.gm-seg span{position:relative;background:#fff;border-radius:6px;padding:1px 5px;font-weight:800;font-size:12.5px;white-space:nowrap}
.gm-ticks{position:relative;height:38px;margin:2px 0 4px}
.gm-ticks span{position:absolute;top:0;transform:translateX(-50%);font-size:12px;font-weight:800;color:var(--tinta);text-align:center}
.gm-ticks span::before{content:"";display:block;width:2px;height:6px;background:#8b8196;margin:0 auto 1px}
.gm-ticks span.gm-t1::before{height:20px}
.gm-trava{background:#faf7f9;border-style:dashed}.gm-trava .gm-pilula{background:#a89db0}.gm-trava .gm-estado{color:var(--cinza)}
.gm-trava-geral{background:#faf7f9;border-style:dashed;text-align:center}.gm-trava-geral b{font-size:16px}
.gm-entra{animation:gm-sobe .45s ease-out}
@media (prefers-reduced-motion:reduce){.gm-root *{animation:none!important;transition:none!important}}
.gm-root{max-width:820px;padding:0 12px 40px}
.gm-fixa{position:sticky;top:0;z-index:20;background:rgba(251,246,249,.96);backdrop-filter:blur(6px);margin:0 -12px 14px;padding:10px 14px 4px;border-bottom:1px solid var(--linha);display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:end}
.gm-fixa-l label{display:block;font-size:12px;font-weight:700;color:var(--cinza)}
.gm-fixa .gm-campo{padding:2px 12px}.gm-fixa .gm-campo span{font-size:20px}.gm-fixa .gm-campo input{font-size:clamp(24px,6.5vw,30px)}
.gm-fixa-r{display:flex;gap:12px;text-align:right}.gm-fixa-r small{display:block;font-size:10.5px;font-weight:600;color:var(--cinza)}.gm-fixa-r b{font-size:clamp(15px,4vw,19px);white-space:nowrap}.gm-fixa-lid b{color:var(--laranja)}
.gm-fixa .gm-range{grid-column:1/-1;margin:2px 0 0;height:26px}
.gm-pg{scroll-margin-top:150px;background:#fff;border:1px solid var(--linha);border-radius:18px;margin:0 0 18px;overflow:hidden;box-shadow:0 2px 10px rgba(43,36,51,.05)}
.gm-pg-top{height:8px;background:linear-gradient(90deg,var(--rosa),var(--rosa2) 60%,#4cbcd6)}
.gm-pg-cab{padding:12px 20px 0;font-size:11px;letter-spacing:.09em;font-weight:700;color:var(--cinza)}
.gm-pg-corpo{padding:10px 20px 18px}
.gm-pg-rod{display:flex;justify-content:space-between;gap:10px;padding:10px 20px;border-top:1px solid var(--linha);font-size:11.5px;color:var(--cinza);background:#fdf9fb}
.gm-h1{font-size:clamp(26px,6vw,34px);line-height:1.15;margin:4px 0 8px;letter-spacing:-.02em}
.gm-lead{margin:0 0 16px;color:var(--cinza);font-size:16.5px}
.gm-h2{display:flex;align-items:flex-start;gap:12px;font-size:clamp(20px,4.8vw,25px);line-height:1.2;margin:2px 0 12px;letter-spacing:-.01em;--c:var(--rosa)}
.gm-h2.gm-laranja{--c:var(--laranja)}.gm-h2.gm-azul{--c:var(--azul)}.gm-h2.gm-roxo{--c:var(--roxo)}
.gm-h2 .gm-num{margin-top:-2px}
.gm-h2-solto{font-size:clamp(20px,4.8vw,25px);margin:14px 0 10px;letter-spacing:-.01em}
.gm-h3{font-size:16.5px;margin:16px 0 6px}
.gm-exemplo{background:var(--rosa-c);border:2px solid var(--rosa);border-radius:18px;padding:14px 16px;margin:0 0 6px}
.gm-exemplo-t{display:inline-block;background:var(--rosa);color:#fff;font-size:11.5px;font-weight:800;letter-spacing:.08em;border-radius:999px;padding:3px 10px}
.gm-exemplo-p{margin:8px 0 6px;font-size:18px}.gm-exemplo-p b{font-size:clamp(26px,7vw,34px);color:var(--rosa);letter-spacing:-.02em}
.gm-caminho{list-style:none;margin:0 0 6px;padding:0;display:grid;gap:10px}
.gm-passo{--c:var(--rosa)}.gm-passo.gm-laranja{--c:var(--laranja)}.gm-passo.gm-azul{--c:var(--azul)}.gm-passo.gm-roxo{--c:var(--roxo)}
.gm-passo button{width:100%;display:flex;align-items:center;gap:12px;text-align:left;background:#fff;border:2px solid var(--linha);border-left:6px solid var(--c);border-radius:14px;padding:10px 12px;cursor:pointer;font-family:inherit;color:inherit}
.gm-passo button:hover{border-color:var(--c)}.gm-passo button:focus-visible{outline:3px solid var(--azul);outline-offset:2px}
.gm-passo .gm-num{background:var(--c)}
.gm-passo-txt{flex:1;display:flex;flex-direction:column;min-width:0}.gm-passo-txt b{font-size:16px}.gm-passo-txt small{font-size:13.5px;color:var(--cinza)}
.gm-passo-v{display:flex;flex-direction:column;align-items:flex-end;font-size:clamp(16px,4.2vw,20px);color:var(--c);white-space:nowrap}.gm-passo-v em{font-style:normal;color:#b9aec0}.gm-passo-v small{font-size:11px;color:var(--cinza);font-weight:600}
.gm-caixa{--c:var(--rosa);background:color-mix(in srgb,var(--c) 9%,#fff);border-left:5px solid var(--c);border-radius:12px;padding:12px 14px;margin:14px 0 6px}
.gm-caixa.gm-azul{--c:var(--azul)}.gm-caixa.gm-roxo{--c:var(--roxo)}.gm-caixa.gm-laranja{--c:var(--laranja)}
.gm-caixa-t{display:block;margin-bottom:4px;font-size:15.5px}.gm-caixa p{margin:4px 0;font-size:15.5px}
.gm-lista{margin:4px 0 0;padding-left:22px;font-size:15.5px}.gm-lista li{margin:4px 0}
.gm-trava-pg{background:#faf7f9;border:2px dashed #d9cdd5;border-radius:14px;padding:14px;margin:8px 0 12px;color:var(--cinza);font-size:15.5px}
.gm-peq{margin:6px 0 0;font-size:14px;color:var(--cinza)}
.gm-tres{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0}
.gm-tres-c{background:#f7f2f5;border-radius:14px;padding:10px 8px;text-align:center;display:flex;flex-direction:column;gap:2px;border:2px solid transparent}
.gm-tres-c.ok{background:var(--rosa-c);border-color:var(--rosa3)}
.gm-tres-c small{font-size:11.5px;font-weight:700;color:var(--cinza)}.gm-tres-c b{font-size:clamp(26px,7vw,34px);color:var(--rosa);line-height:1.1}.gm-tres-c span{font-size:11.5px;color:var(--cinza)}
.gm-reg{margin:6px 0 4px}
.gm-pin{position:relative;height:30px}.gm-pin span{position:absolute;bottom:3px;background:var(--tinta);color:#fff;border-radius:8px;padding:2px 8px;font-size:12px;font-weight:800;white-space:nowrap}
.gm-regua{height:46px}.gm-seg.gm-dim{opacity:.35}
.gm-f0{background:#d9cfdc}.gm-f1{background:var(--rosa3)}.gm-f2{background:var(--rosa2)}.gm-f3,.gm-f4{background:var(--rosa)}
.gm-ticks{height:44px}.gm-ticks span{line-height:1.15;font-size:12px}.gm-ticks span i{font-style:normal;font-size:10.5px;font-weight:600;color:var(--cinza)}
.gm-ticks span.gm-t1::before{height:22px}
.gm-vendido{margin:2px 0 8px;font-weight:700}.gm-vendido b{color:var(--rosa);font-size:18px}
.gm-ms{display:flex;gap:12px;margin:12px 0}.gm-ms>div{flex:1;min-width:0}.gm-ms b{font-size:16px}.gm-ms p{margin:4px 0 0;font-size:15px}
.gm-mn{flex:none;width:30px;height:30px;border-radius:50%;background:var(--rosa);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:1px}
.gm-gera{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--rosa);color:#fff;border-radius:14px;padding:12px 16px;margin-top:14px}
.gm-gera small{display:block;font-size:13px;font-weight:700}.gm-gera span{font-size:13.5px;opacity:.95}.gm-gera>b{font-size:clamp(24px,6.5vw,30px)}
.gm-cc{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}
.gm-cc>div{border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:4px;font-size:14.5px}
.gm-errado{background:#fbeeee;border:2px solid #e6b3b3}.gm-certo{background:#eaf6ef;border:2px solid #a8d6bb}
.gm-errado>b{color:var(--erro)}.gm-certo>b{color:#1c8a55}.gm-cc em{font-style:normal;color:var(--cinza)}.gm-cc strong{font-size:clamp(22px,6vw,28px)}.gm-errado strong{color:var(--erro)}.gm-certo strong{color:#1c8a55}
.gm-somas{display:grid;gap:8px;margin:6px 0 12px}
.gm-soma-l{display:flex;align-items:center;gap:12px;border:1px solid var(--linha);border-radius:14px;padding:10px 12px}.gm-soma-l.off{opacity:.55;background:#faf7f9}
.gm-soma-l>div{flex:1;min-width:0}.gm-soma-l b{display:block}.gm-soma-l small{font-size:13px;color:var(--cinza)}.gm-soma-l>b{font-size:clamp(18px,4.6vw,22px);color:var(--rosa);white-space:nowrap}
.gm-soma-rs{flex:none;width:34px;height:34px;border-radius:50%;background:var(--rosa-c);color:var(--rosa);font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
.gm-soma-total{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--rosa);color:#fff;border-radius:14px;padding:12px 16px}
.gm-soma-total small{display:block;font-weight:800;letter-spacing:.05em;font-size:12px}.gm-soma-total span{font-size:14px;opacity:.95}.gm-soma-total>b{font-size:clamp(26px,7vw,34px)}
.gm-dias{display:grid;gap:8px;margin:8px 0}
.gm-dias>div{display:grid;grid-template-columns:30px 1fr auto;gap:10px;align-items:center;border-radius:12px;padding:10px 12px;font-size:14.5px}
.gm-dias p{margin:0}.gm-dias b{font-size:13.5px;text-align:right}.gm-dias span{font-weight:800;font-size:18px}
.gm-dias .ok{background:#eef8f2}.gm-dias .ok span,.gm-dias .ok b{color:#1c8a55}.gm-dias .nao{background:#fbeeee}.gm-dias .nao span,.gm-dias .nao b{color:var(--erro)}
.gm-fixas-t{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:10px 0}
.gm-fixas-t>div{background:var(--roxo-c);border-radius:14px;padding:14px 6px;text-align:center;display:flex;flex-direction:column}.gm-fixas-t b{font-size:clamp(18px,5vw,24px);color:var(--roxo)}.gm-fixas-t small{font-size:12px;color:var(--cinza)}
.gm-tabela-c td:first-child{font-weight:700}.gm-tabela-c tr.gm-destaque td{background:var(--laranja-c)!important;font-weight:800}
.gm-faq{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gm-faq>div{background:#faf5f8;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:14px}.gm-faq b{font-size:14px}
.gm-contadores{margin-top:10px}
@media (max-width:560px){.gm-pg-corpo{padding:8px 14px 14px}.gm-pg-cab,.gm-pg-rod{padding-left:14px;padding-right:14px}.gm-cc,.gm-faq{grid-template-columns:1fr}.gm-tres-c{padding:8px 4px}.gm-fixa{grid-template-columns:minmax(0,1fr);gap:6px}.gm-fixa-l{min-width:0}.gm-fixa-r{justify-content:space-between;text-align:left}.gm-fixa-r small{font-size:9.5px}.gm-fixa .gm-range{grid-column:1}.gm-pg{scroll-margin-top:190px}.gm-dias>div{grid-template-columns:26px 1fr}.gm-dias b{grid-column:2;text-align:left}}
@media print{.gm-root{display:none!important}}

.gm-fixa>*{min-width:0}
.gm-gera>b,.gm-soma-total>b{white-space:nowrap;flex:none}
.gm-gera>div,.gm-soma-total>div{min-width:0;flex:1}
.gm-ticks{height:46px}.gm-ticks span{white-space:nowrap}.gm-ticks span::before{height:6px}.gm-ticks span.gm-t1::before{height:6px}
.gm-seg span{font-size:12px}
.gm-barra>div{min-width:72px}.gm-barra small{white-space:nowrap}

.gm-reg{position:relative}
.gm-pin{height:34px}.gm-pin span{bottom:8px;box-shadow:0 2px 6px rgba(43,36,51,.25)}
.gm-marca{position:absolute;top:28px;height:72px;width:0;z-index:3}
.gm-marca::before{content:"";position:absolute;left:-1.5px;top:0;bottom:0;width:3px;background:var(--tinta);border-radius:2px}
.gm-marca i{position:absolute;left:-8px;top:36px;width:16px;height:16px;border-radius:50%;background:#fff;border:4px solid var(--tinta);box-sizing:border-box}
.gm-onde{display:flex;gap:10px;align-items:flex-start;margin:6px 0 0;padding:10px 12px;background:#f4eff6;border-radius:12px;font-size:15px}
.gm-onde-p{flex:none;width:12px;height:12px;border-radius:50%;background:var(--tinta);margin-top:6px}.gm-onde-t{flex:1;min-width:0}

.gm-ms{background:#fff;border:1px solid var(--linha);border-radius:16px;padding:14px 16px;margin:12px 0;gap:14px;align-items:flex-start}
.gm-ms>div>b{font-size:17px;display:block}
.gm-ms>div>p{margin:8px 0 0;font-size:16px}
.gm-ms .gm-conta{margin:10px 0 4px}
.gm-ms .gm-peq{margin:8px 0 0;font-size:14px}
.gm-mn{width:34px;height:34px;font-size:16px}
.gm-marca{height:54px}.gm-marca i{top:21px}
.gm-vendido b{margin-right:.35em}

/* ---------- disposição em tela larga: tokens do design system, painel escuro, colunas ---------- */
.gm-cols,.gm-col,.gm-passos3{display:contents}
.gm-ds{--rosa:var(--ds-accent);--rosa-c:var(--ds-accent-soft);--tinta:var(--ds-ink);--cinza:var(--ds-ink-muted);--linha:var(--ds-border);--erro:var(--ds-danger);font-family:var(--font-ds);max-width:none;padding:0 0 40px}
.gm-ds .gm-campo input,.gm-ds .gm-atalhos button,.gm-ds .gm-contador-ctrl button,.gm-ds .gm-link{font-family:var(--font-ds)}
.gm-ds .gm-pg{border-radius:var(--ds-r-card-lg);border-color:var(--ds-border);box-shadow:none}
.gm-ds .gm-pg-cab{padding:16px 28px 0;color:var(--ds-ink-faint)}
.gm-ds .gm-pg-corpo{padding:12px 28px 24px}
.gm-ds .gm-pg-rod{padding:10px 28px;background:var(--ds-surface-muted);border-color:var(--ds-divider)}
.gm-ds .gm-fixa{top:68px;margin:0 0 20px;padding:14px 22px;background:var(--ds-surface-dark);color:var(--ds-ink-on-dark);border:0;border-radius:var(--ds-r-card-lg);backdrop-filter:none}
.gm-ds .gm-fixa-l label,.gm-ds .gm-fixa-r small{color:var(--ds-ink-on-dark-muted)}
.gm-ds .gm-fixa .gm-campo{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.18)}
.gm-ds .gm-fixa .gm-campo span{color:var(--ds-accent-kicker-dark)}
.gm-ds .gm-fixa .gm-campo input{color:var(--ds-ink-on-dark)}
.gm-ds .gm-fixa .gm-campo:focus-within{box-shadow:0 0 0 3px rgba(209,54,112,.45)}
.gm-ds .gm-fixa-r b{color:var(--ds-ink-on-dark)}.gm-ds .gm-fixa-lid b{color:color-mix(in srgb,var(--laranja) 60%,#fff)}
.gm-ds .gm-fixa .gm-range::-webkit-slider-runnable-track{background:linear-gradient(to right,var(--ds-accent) var(--p),rgba(255,255,255,.16) var(--p))}
.gm-ds .gm-fixa .gm-range::-moz-range-track{background:rgba(255,255,255,.16)}
.gm-ds .gm-fixa .gm-range::-webkit-slider-thumb{border-color:var(--ds-accent);box-shadow:none}
.gm-ds .gm-passo button,.gm-ds .gm-ms,.gm-ds .gm-soma-l{border-width:1px}
@media (min-width:1024px){
  .gm-ds .gm-fixa{grid-template-columns:auto minmax(220px,1fr) auto;align-items:center;gap:6px 32px;padding:12px 24px}
  .gm-ds .gm-fixa-l{grid-column:1;grid-row:1}
  .gm-ds .gm-fixa .gm-range{grid-column:2;grid-row:1;margin:0}
  .gm-ds .gm-fixa-r{grid-column:3;grid-row:1;gap:28px}
  .gm-ds .gm-fixa-r b{font-size:22px}
}

/* colunas dentro de cada página */
@media (min-width:1100px){
  .gm-ds .gm-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px 36px;align-items:start}
  .gm-ds .gm-col{display:block;min-width:0}
  .gm-ds .gm-passos3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch}
  .gm-ds .gm-passos3 .gm-ms{margin:10px 0 0}
  .gm-ds .gm-pg-corpo{padding:16px 36px 28px}
}
/* todos os controles da simulação no painel escuro */
.gm-ds .gm-fixa-ctrl{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px;padding-top:10px;margin-top:2px;border-top:1px solid rgba(255,255,255,.1)}
.gm-ds .gm-fixa-ctrl .gm-atalhos{margin:0}
.gm-ds .gm-fixa-ctrl .gm-atalhos button{background:transparent;border:1px solid rgba(255,255,255,.2);color:var(--ds-ink-on-dark);min-height:40px;padding:5px 14px}
.gm-ds .gm-fixa-ctrl .gm-atalhos button small{color:var(--ds-ink-on-dark-muted)}
.gm-ds .gm-fixa-ctrl .gm-atalhos button.on{background:var(--ds-accent);border-color:var(--ds-accent);color:#fff}
.gm-ds .gm-fixa-ctrl .gm-atalhos button.on small{color:#ffe1ec}
.gm-ds .gm-fixa-ctrl .gm-contadores{margin:0;gap:10px 18px}
.gm-ds .gm-fixa-ctrl .gm-contador{flex-direction:row;align-items:center;gap:8px}
.gm-ds .gm-fixa-ctrl .gm-contador-rotulo{font-size:12px;color:var(--ds-ink-on-dark-muted)}
.gm-ds .gm-fixa-ctrl .gm-contador-ctrl{border:1px solid rgba(255,255,255,.2);background:transparent;border-radius:999px}
.gm-ds .gm-fixa-ctrl .gm-contador-ctrl button{width:34px;height:34px;font-size:18px;background:rgba(255,255,255,.08);color:var(--ds-ink-on-dark)}
.gm-ds .gm-fixa-ctrl .gm-contador-ctrl output{min-width:70px;font-size:14px;color:var(--ds-ink-on-dark)}
.gm-ds .gm-fixa-ctrl .gm-contador-ctrl output small{color:var(--ds-ink-on-dark-muted)}

/* cabeçalho dos quadros em faixa clara */
.gm-ds .gm-pg-top{display:none}
.gm-ds .gm-pg-cab{padding-top:13px;padding-bottom:13px;background:var(--ds-surface-muted);border-bottom:1px solid var(--ds-divider)}
.gm-ds .gm-pg>.gm-pg-corpo{padding-top:22px}

/* a barra do simulador para logo abaixo da barra superior do sistema (header: sticky top-3 + h-11 = 56px) */
.gm-ds .gm-pg{scroll-margin-top:290px}
@media (max-width:1023px){.gm-ds .gm-fixa{position:relative;top:0}.gm-ds .gm-pg{scroll-margin-top:80px}}
`;
