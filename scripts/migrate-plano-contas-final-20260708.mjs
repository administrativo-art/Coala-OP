/**
 * Migração final do plano de contas (versão docs/plano-de-contas-dre.md, 2026-07-08).
 *
 * O que faz (tudo preservando IDs, sem deletar nenhuma conta):
 *  1. Renomes (semânticos + cosméticos) e fusão limpeza+consumo.
 *  2. Keywords (searchTerms, máx. 20) e descrições (conceito) por conta.
 *  3. Normalização do campo `group` (contas com group nulo/errado ficavam
 *     invisíveis ou mal agrupadas no seletor de despesas).
 *  4. Criação da conta "Uniformes e EPIs" (id fixo uniformes_epis_v1).
 *  5. Inativações: Materiais de limpeza (fusão), Venda balcão (PDV) e grupo IR/CSLL.
 *  6. Reparo de referências órfãs: pedidos/purchase_financials apontando para
 *     contas deletadas ("Insumos gerais", antiga "Manutenção da máquina") e
 *     despesas/pedido lançados no grupo "Manutenção e conservação".
 *
 * Idempotente: define valores-alvo; re-rodar não muda nada além do já aplicado.
 * ATENÇÃO: sobrescreve searchTerms/description das contas listadas — edições
 * manuais posteriores a 2026-07-08 nessas contas seriam substituídas.
 *
 * USO:
 *   node scripts/migrate-plano-contas-final-20260708.mjs          (dry-run, só relata)
 *   node scripts/migrate-plano-contas-final-20260708.mjs --apply  (grava)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(
  readFileSync('scripts/smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json', 'utf8'),
);
const app = getApps()[0] ?? initializeApp({ credential: cert(sa) });
const fin = getFirestore(app, 'coala-financeiro');
const est = getFirestore(app, 'coala');

// ---------------------------------------------------------------------------
// IDs (do snapshot backups/plano-contas-20260708)
const ID = {
  administrativo: 'rtmp6WKQJnfCckGln7cb',
  insumosComposicao: 'OofGtZoVn15nmmy2xaI8',
  manutencaoMaquina: 'Glkl0TX1NdzeerfRuTvG',
  manutencaoEquipamentos: 'lDI7TyahHpyftuz7FeiW',
  grupoManutencao: '0wikce520QUhEVsv37E7',
  uniformesEpis: 'uniformes_epis_v1',
};
const ORPHAN_INSUMOS_GERAIS = 'MuJjE8gUbpMOYh9cEqXN';
const ORPHAN_MANUT_MAQUINA = 'Eb7kSy9z7ld9AACLXQvo';
// Contas de frete deletadas ("Frete de adquirir insumos" / "Frete de deslocamento
// de máquinas") — regra da casa: frete de aquisição cai em Frete | Compras gerais.
const ORPHAN_FRETE_INSUMOS = 'mbsG0gOjj6zx6SgiGmLl';
const ORPHAN_FRETE_MAQUINAS = 'vvBl3DkOuqBnox3mua80';
const FRETE_COMPRAS_GERAIS = 'yw96wgNNf695d7GaGfiG';

// ---------------------------------------------------------------------------
// Valores-alvo por conta: { name?, group?, active?, searchTerms?, description? }
const ACCOUNT_TARGETS = {
  // --- Renomes ---
  qU6aTGYMZFEkBJvR5om8: {
    name: 'Consultoria de RH',
    searchTerms: ['consultoria rh', 'recrutamento', 'seleção', 'exame admissional', 'aso', 'medicina do trabalho'],
    description: 'Serviços de RH de terceiros (recrutamento, exames, consultoria). NÃO é folha nem encargo (grupo Recursos humanos).',
  },
  pus3owlnyqoBh9kGIUdi: {
    name: 'Agência | marketing terceirizado',
    searchTerms: ['agência', 'social media', 'gestor de tráfego', 'assessoria marketing', 'freelancer marketing'],
    description: 'Serviço contínuo de agência/profissional de marketing. O custo de mídia em si vai em Redes sociais | mídia paga.',
  },
  uwnEySkivE1d0opf6Fzz: {
    name: 'Redes sociais | mídia paga',
    searchTerms: ['meta ads', 'facebook ads', 'instagram ads', 'google ads', 'impulsionamento', 'tráfego pago', 'boost'],
    description: 'Investimento direto em anúncios. Quem gerencia vai em Agência | marketing terceirizado.',
  },
  Y0iZa4LzOFFg0eJAzNHN: {
    name: 'Publicidade geral | offline',
    group: 'marketing',
    searchTerms: ['rádio', 'outdoor', 'busdoor', 'carro de som', 'patrocínio evento', 'mídia offline'],
    description: 'Publicidade fora do digital. Impressos vão em Material gráfico.',
  },
  '0om0QDLPbADBIAzXAcyP': {
    name: 'Outras compras para estoque',
    searchTerms: ['outras compras', 'estoque diverso'],
    description: 'Residual. Atenção: classificação errada aqui SOME da DRE. Teste: "isso vira produto vendido?" Se não, é despesa.',
  },
  p3yNvBlcIOGJsAVxMWMi: {
    name: 'Fundos e outros investimentos',
    group: 'investimentos',
    searchTerms: ['fundo', 'ações', 'fii', 'cripto', 'investimento variável'],
    description: 'Investimentos fora de renda fixa. CDB/Tesouro vai em Aplicação em renda fixa.',
  },
  iY5kCB0AlUUQ3qp9dSZR: { name: 'Custos variáveis complementares' },
  O8lAatnfHBgY1ntC25Ax: {
    name: 'IPTU | taxas do ponto',
    searchTerms: ['iptu', 'alvará', 'licença', 'taxa funcionamento', 'bombeiros', 'vigilância sanitária'],
    description: 'Impostos e licenças ligados ao ponto físico.',
  },
  Xr4p7clYE4EElEom21p3: {
    name: 'IOF | tarifas bancárias',
    searchTerms: ['iof', 'tarifa', 'ted', 'pix tarifa', 'manutenção conta', 'pacote banco'],
    description: 'Tarifas de conta e IOF. Juro de atraso vai em Juros e multas.',
  },
  estoque_compras_insumos_v2: { name: 'Estoque / Compras de insumos' },

  // --- Fusão: consumo assume limpeza; limpeza é inativada ---
  '5OHxKNImWToNsnL7qEd9': {
    name: 'Materiais de limpeza e consumo',
    searchTerms: [
      'limpeza', 'consumo', 'detergente', 'desinfetante', 'água sanitária', 'pano', 'vassoura',
      'rodo', 'esponja', 'sabão', 'álcool', 'luva', 'luva descartável', 'luva de borracha',
      'papel toalha', 'guardanapo', 'touca descartável', 'filme pvc', 'papel filme', 'palito',
    ],
    description:
      'Descartáveis e produtos de limpeza consumidos na operação: higienização da unidade + descartáveis de manipulação. NÃO entra: o que compõe o produto vendido (copo/tampa/canudo → Embalagens), utensílios duráveis (→ Utensílios) e uniformes/EPIs reutilizáveis (→ Uniformes e EPIs).',
  },
  n36JHWlM0go8OlqIaJwR: {
    active: false,
    description: 'Fundida em "Materiais de limpeza e consumo" (2026-07-08). Histórico preservado.',
  },

  // --- Inativações ---
  '2MahVlZrMvFdGwRR7Tq2': {
    active: false,
    description: 'Conta informativa: a Receita Bruta da DRE vem das transações, não do plano. Inativa para impedir lançamento.',
  },
  EU4LpX30R0oVs4Z15cti: { active: false },

  // --- Normalização de group (contas invisíveis/mal agrupadas no seletor) ---
  [ID.manutencaoMaquina]: {
    group: 'administrativo',
    searchTerms: ['taylor', 'máquina soft', 'soft', 'oring', 'o-ring', 'batedor', 'lubrificante taylor', 'peça máquina', 'técnico taylor'],
    description: 'Peças, técnico e insumos exclusivos da máquina soft (KPI do ativo crítico). Outro equipamento vai em Manutenção de equipamentos.',
  },
  K7t35k1pYATVn13Y22Bz: {
    group: 'tecnologia',
    searchTerms: ['celular', 'chip', 'plano móvel', 'tim', 'vivo', 'claro', 'recarga'],
  },
  sdjmyJPJoVyFhT31ByDS: { group: 'tecnologia', searchTerms: ['claude', 'anthropic', 'claude code'] },
  YHndBKusBiPAHGimkLrj: { group: 'tecnologia', searchTerms: ['gemini', 'google ai', 'google one ai'] },
  A0X3ggsBxc7SDEjyUrus: { group: 'tecnologia', searchTerms: ['gpt', 'chatgpt', 'openai', 'codex'] },
  cBrMJE7BbTS0XwsjtEr9: { group: 'administrativo' }, // Frete (grupo)
  yw96wgNNf695d7GaGfiG: {
    group: 'administrativo',
    searchTerms: ['frete', 'frete fornecedor', 'transporte compra', 'entrega fornecedor', 'correios', 'jadlog', 'transportadora compra'],
    description: 'Frete pago na compra de insumos/mercadorias. Regra da casa: como o CMV bypassa o plano, todo frete de aquisição cai aqui. Frete de venda vai em Custos variáveis.',
  },
  jY3tReCGgBnFlOG3mnOF: { group: 'marketing' }, // Marketing (grupo)
  N5ROKLTPcH6mOXOiBDat: { group: 'administrativo' }, // Terceirizados (grupo)
  XVP0TluLmvkBpHrnfpZ3: { group: 'rh' }, // Folha de pagamento (grupo)
  bT7aoZU0ElkpUDNddE5i: { group: 'administrativo' }, // Publicidade e propaganda (inativa)
  // Árvores patrimoniais nunca tiveram group — recebem chaves próprias
  CDqq0Jokn59O0tWf2AVX: { group: 'patrimonial' }, // Ativo imobilizado (grupo)
  LWspK5UYcB9ehd3IIh2F: { group: 'investimentos' }, // Aplicações financeiras (grupo)

  // --- Keywords/descrições (demais contas) ---
  R9YsfkpcMEy1DoswOUqg: {
    searchTerms: ['das', 'simples', 'simples nacional', 'guia mensal', 'imposto federal'],
    description: 'Guia mensal do Simples Nacional. NÃO lançar multa por atraso do DAS (vai em Juros e multas).',
  },
  sFVZ3tcW0tdzg8t8eYSW: {
    searchTerms: ['dare', 'icms', 'difal', 'antecipação icms', 'sefa', 'imposto estadual'],
    description: 'Guias estaduais (ICMS antecipação/DIFAL). NÃO confundir com DAS.',
  },
  FzUQ6oejC6f6Zws6OcJR: {
    searchTerms: ['devolução', 'cancelamento', 'estorno venda', 'reembolso cliente', 'troca'],
    description: 'Valor devolvido ao cliente por venda cancelada ou troca. NÃO é estorno de compra a fornecedor.',
  },
  iwTN0vpF8lbUFF4TqFXs: {
    searchTerms: ['desconto', 'cortesia', 'cupom', 'promoção', 'abatimento'],
    description: 'Descontos fora do preço de tabela. Se o PDV já registra líquido, usar só para descontos manuais/extraordinários.',
  },
  IqaYLNxMtwflZgy5kL3S: {
    searchTerms: ['ajuste cmv', 'correção custo', 'diferença cmv'],
    description: 'Correções do CMV automático quando o PDV diverge do real. Uso excepcional, de fechamento.',
  },
  bfspFKbrxUt2EP98ZlTV: {
    searchTerms: ['perda', 'vencido', 'estragou', 'queda de energia', 'descongelou', 'avaria'],
    description: 'Insumo perdido por vencimento, falta de energia, avaria. NÃO é sobra normal de produção.',
  },
  J1c49RRes2USZsbNn1aT: {
    searchTerms: ['inventário', 'contagem', 'diferença estoque', 'quebra'],
    description: 'Diferença entre estoque físico contado e sistema. Lançar no fechamento da contagem.',
  },
  TU0Cz3wixBoGEk7h7Vau: {
    searchTerms: ['frete venda', 'frete produto', 'entrega cliente', 'motoboy venda'],
    description: 'Frete que só existe porque houve venda (entrega ao cliente). Frete de compra vai em Frete | Compras gerais.',
  },
  '2aI6HPvDRuSEylDoyb1J': {
    searchTerms: ['embalagem extra', 'sacola avulsa', 'embalagem emergência', 'compra local embalagem'],
    description: 'Compra emergencial de embalagem consumida direto, sem passar pelo estoque. Compra planejada vai em Estoque / Compras de insumos.',
  },
  hxmZSrbCPFgfYEC4TseV: {
    searchTerms: ['custo variável', 'outros custos', 'extraordinário venda'],
    description: 'Residual: só quando nenhuma conta irmã se aplica. Recorrência aqui = criar conta específica.',
  },
  vuLqBaYv6ZgSALpLQiy9: {
    searchTerms: ['salário', 'pagamento funcionário', 'folha', 'holerite', 'contracheque', 'adiantamento'],
    description: 'Salário líquido e adiantamentos CLT. Encargos têm conta própria; freelancer vai em Terceirizados.',
  },
  XdrX3AH1pqYHvn51J93c: {
    searchTerms: ['inss', 'gps', 'previdência', 'encargo'],
    description: 'Guia de INSS parte empresa.',
  },
  '3osoxxpuzhWak7NkqF2z': {
    searchTerms: ['fgts', 'fundo de garantia', 'grf', 'fgts digital'],
    description: 'Guia mensal do FGTS e rescisório.',
  },
  CLBwdv1KXYJV4bcfkxPe: {
    searchTerms: ['comissão', 'meta', 'percentual venda'],
    description: 'Comissão sobre vendas. Prêmio sem vínculo com venda vai em Bonificações.',
  },
  zL61h8XxaZIgvFu7chMw: {
    searchTerms: ['bônus', 'premiação', 'prêmio', 'incentivo', 'gratificação'],
    description: 'Prêmios por desempenho e campanhas internas. Comissão de venda tem conta própria.',
  },
  '8CGY2xAZ8GDI0rd55FZg': { searchTerms: ['vt', 'vale transporte', 'passagem', 'ônibus', 'recarga cartão'] },
  i8BOn55K6c8g2LrkIb03: { searchTerms: ['odonto', 'dental', 'plano dentário'] },
  '7WOFapEnWMC7Hw2F38Tk': { searchTerms: ['va', 'vr', 'vale alimentação', 'vale refeição', 'ticket', 'alelo'] },
  cCVe1KVCwXMFw40roM5s: {
    searchTerms: ['sindicato', 'sindical', 'contribuição patronal', 'assistencial'],
    description: 'Contribuições ao sindicato patronal ou laboral.',
  },
  [ID.manutencaoEquipamentos]: {
    searchTerms: ['conserto', 'técnico', 'freezer', 'geladeira', 'liquidificador', 'balança', 'peça', 'assistência'],
    description: 'Manutenção de qualquer equipamento EXCETO a máquina soft. Reparo do imóvel vai em Pequenos reparos.',
  },
  QyqZUKnVzzNuYuF1Gt6p: {
    searchTerms: ['reparo', 'conserto quiosque', 'pintura', 'elétrica', 'hidráulica', 'lâmpada', 'torneira', 'fechadura'],
    description: 'Reparos da estrutura física. Reforma/melhoria grande vai em Obras, reformas e instalações (patrimonial).',
  },
  fQOyQpN7mSPVZ1iGGPdq: {
    searchTerms: ['motoboy', 'entregador terceirizado', 'transportadora', 'carreto', 'mudança'],
    description: 'Transporte/entrega contratados sem vínculo. Frete atrelado a compra vai em Frete | Compras gerais.',
  },
  hmG7Nsp6B0gktF6NiN0X: {
    searchTerms: ['banner', 'panfleto', 'adesivo', 'cartão visita', 'impressão', 'gráfica', 'placa'],
    description: 'Impressos e materiais visuais físicos. Telas de cardápio vão em Sinalização digital (Tecnologia).',
  },
  ph5FM2utYgW6c6uDtKQb: {
    searchTerms: ['influenciador', 'influencer', 'permuta', 'publi', 'parceria', 'embaixador'],
    description: 'Pagamentos e permutas com criadores e parceiros.',
  },
  CFxyiyxbSdo9DGMabaON: {
    searchTerms: ['transferência', 'remanejamento', 'entre lojas', 'entre quiosques', 'deslocamento estoque'],
    description: 'Transporte entre unidades próprias.',
  },
  B99exQfIXKhrln7s8eyv: { searchTerms: ['contador', 'contabilidade', 'honorário contábil', 'escritório contábil'] },
  '8rElWw58VoXeMRteDSKz': {
    searchTerms: ['colher', 'pegador', 'pote', 'espátula', 'bacia', 'jarra', 'faca', 'utensílio', 'medidor'],
    description: 'Ferramentas duráveis de baixo valor (não vão ao cliente, não são ativo). Descartável vai em Materiais de limpeza e consumo. Equipamento de valor vai em Ativo imobilizado.',
  },
  [ID.insumosComposicao]: {
    searchTerms: ['base', 'leite', 'leite em pó', 'açúcar', 'emulsificante', 'liga neutra', 'saborizante', 'polpa', 'fruta', 'chocolate', 'essência'],
    description: 'Matéria-prima que entra na receita do produto. Conta principal de compras.',
  },
  gdNkWMam7BQbaRADNZTm: {
    searchTerms: ['copo', 'tampa', 'canudo', 'colher descartável', 'casquinha', 'cascão', 'embalagem', 'sacola', 'pote venda'],
    description: 'Embalagem que sai com o produto vendido. Compra emergencial fora do estoque vai em Custos variáveis.',
  },
  z3NlsD6yXEXMVHJNHlRH: {
    searchTerms: ['topping', 'calda', 'cobertura', 'granulado', 'confete', 'leite condensado', 'paçoca', 'farofa', 'gotas', 'marshmallow'],
    description: 'Complementos que finalizam o produto ou o cliente adiciona.',
  },
  OpUgLUPHDjc9eJgyDHTd: {
    searchTerms: ['revenda', 'água mineral', 'refrigerante', 'picolé pronto', 'produto pronto'],
    description: 'Produto comprado pronto e revendido sem transformação.',
  },
  XZUabn5gGmdR8iZiFbtc: { searchTerms: ['internet', 'fibra', 'wifi', 'provedor', 'link', 'starlink'] },
  '3JH91LBA0PDrYNA1mNuJ': {
    searchTerms: ['pdv', 'mensalidade pdv', 'sistema venda', 'maquininha software'],
    description: 'Mensalidade do software de PDV. Taxa da maquininha sobre venda vai em Taxas de cartão (Financeiro).',
  },
  R1NgOtrJaLzckHs0Sx0D: {
    searchTerms: ['tv', 'tela', 'painel digital', 'cardápio digital', 'menu board', 'mídia indoor'],
    description: 'Assinatura/serviço das telas de cardápio. Compra da TV vai em Ativo imobilizado.',
  },
  BowvTPhPHd6qYvsjs9GA: { searchTerms: ['sistema rh', 'ponto eletrônico', 'folha software', 'tangerino', 'solides'] },
  H480XpYfzaOOs0QMJhcC: {
    searchTerms: ['aluguel', 'locação', 'luvas', 'ponto'],
    description: 'Aluguel do ponto.',
  },
  jYBGXEfjDQbqx0gKViQN: {
    searchTerms: ['condomínio', 'taxa shopping', 'fundo promoção', 'rateio'],
    description: 'Condomínio e taxas do shopping, incluindo fundo de promoção compulsório.',
  },
  CwOgsvgF2QbheItxK5Lo: { searchTerms: ['energia', 'luz', 'equatorial', 'conta de luz'] },
  '9GGj0L1MtFn6WKzvz8S7': { searchTerms: ['água', 'saneamento', 'cosanpa', 'esgoto'] },
  iUhE3olNOCsPrevDG0KS: {
    searchTerms: ['juros', 'multa', 'atraso', 'mora', 'encargo atraso'],
    description: 'Juros/multas por atraso em qualquer obrigação. O principal vai na conta original; aqui só o acréscimo.',
  },
  ybXT1oSjyqDdtGPOsAti: {
    searchTerms: ['taxa cartão', 'mdr', 'stone', 'débito', 'crédito', 'taxa maquininha'],
    description: 'MDR descontado sobre vendas em cartão.',
  },
  '9rYkpoScI5X2HC893bNj': {
    searchTerms: ['antecipação', 'recebíveis', 'deságio', 'adiantamento vendas'],
    description: 'Custo de antecipar o fluxo do cartão. Separado do MDR para medir o custo da decisão de antecipar.',
  },
  kWCoanlVDW6GNC2rcBCv: {
    searchTerms: ['rendimento', 'juros recebidos', 'cashback', 'cdi rendimento'],
    description: 'Rendimentos de aplicação, cashback, juros ativos.',
  },
  '0iLDV71QaSmwtlxCZyat': {
    searchTerms: ['não operacional', 'doação', 'multa trânsito', 'despesa pessoal sócio', 'extraordinário'],
    description: 'Gasto sem relação com a operação. Frequência aqui = algo mal classificado.',
  },
  b9la9AJbkA5DSML8ALMX: {
    searchTerms: ['venda de bem', 'sucata', 'indenização recebida', 'prêmio', 'receita extraordinária'],
    description: 'Entrada fora da operação: venda de equipamento usado, indenizações.',
  },
  '6KgVwllAo3unPAaIvspW': {
    group: 'patrimonial',
    searchTerms: ['máquina', 'freezer', 'geladeira', 'expositor', 'batedeira', 'compra equipamento'],
    description: 'Equipamentos de valor relevante e vida útil longa. Conserto vai em Manutenção (Administrativo).',
  },
  xo8Y6XtHjpRvCKN8yXoI: { group: 'patrimonial', searchTerms: ['mesa', 'cadeira', 'balcão', 'prateleira', 'armário', 'banqueta'] },
  '4AANIpelMFaw9QJdcRGX': {
    group: 'patrimonial',
    searchTerms: ['notebook', 'computador', 'impressora', 'tablet', 'celular aparelho', 'tv', 'monitor', 'roteador'],
    description: 'Compra do hardware. Assinatura/serviço vai em Tecnologia.',
  },
  gzxmUClqou6F1SKaa6G1: {
    group: 'patrimonial',
    searchTerms: ['obra', 'reforma', 'instalação', 'marcenaria', 'vidraçaria', 'ar condicionado instalação', 'projeto'],
    description: 'Investimento em melhoria da estrutura. Reparo de rotina vai em Pequenos reparos.',
  },
  yEsWZSVtl5fIU4fVaWOp: {
    group: 'investimentos',
    searchTerms: ['cdb', 'renda fixa', 'tesouro', 'lci', 'lca', 'aplicação'],
    description: 'Dinheiro aplicado em renda fixa. Rendimento resgatado vai em Receita financeira.',
  },
  e3Zhtk5bL1CjmPBE2jal: {
    group: 'investimentos',
    searchTerms: ['reserva', 'caixa emergência', 'provisão', 'colchão'],
    description: 'Transferência para a reserva de emergência.',
  },
};

const NEW_ACCOUNTS = [
  {
    id: ID.uniformesEpis,
    data: {
      name: 'Uniformes e EPIs',
      parentId: ID.administrativo,
      group: 'administrativo',
      dre_position: 'despesas_operacionais',
      is_dre_account: true,
      active: true,
      searchTerms: ['uniforme', 'fardamento', 'camisa equipe', 'epi', 'avental', 'touca de tecido', 'bota', 'luva térmica', 'luva de corte', 'crachá'],
      description: 'Vestuário de trabalho e EPIs duráveis/reutilizáveis. Regra da luva: só luva de proteção durável (térmica de freezer, malha de corte). Descartáveis vão em Materiais de limpeza e consumo.',
    },
  },
];

// Reparos pontuais: despesas e pedidos lançados em grupo ou em conta deletada.
const EXPENSE_FIXES = {
  VCeudktcbFnRJlkKBy4H: { id: ID.manutencaoEquipamentos, name: 'Manutenção de equipamentos' },
  gpyw3ini2HJw664hNvlC: { id: ID.manutencaoMaquina, name: 'Manutenção da máquina de sorvete' },
};
const ORDER_FIXES = {
  jlIS9BYEIF4qi19JvUZE: { id: ID.manutencaoMaquina, name: 'Manutenção da máquina de sorvete' },
  d7QUyzskJ2HeQbrlNHgX: { id: ID.manutencaoEquipamentos, name: 'Manutenção de equipamentos' },
};
const ORPHAN_REMAP = {
  [ORPHAN_INSUMOS_GERAIS]: { id: ID.insumosComposicao, name: 'Insumos composição' },
  [ORPHAN_MANUT_MAQUINA]: { id: ID.manutencaoMaquina, name: 'Manutenção da máquina de sorvete' },
  [ORPHAN_FRETE_INSUMOS]: { id: FRETE_COMPRAS_GERAIS, name: 'Frete | Compras gerais' },
  [ORPHAN_FRETE_MAQUINAS]: { id: FRETE_COMPRAS_GERAIS, name: 'Frete | Compras gerais' },
};

// ---------------------------------------------------------------------------
let changes = 0;
function log(kind, msg) {
  changes += 1;
  console.log(`${APPLY ? '[APLICADO]' : '[DRY-RUN] '} ${kind}: ${msg}`);
}

async function run() {
  // 1) Contas
  const accountsSnap = await fin.collection('accounts').get();
  const accountById = new Map(accountsSnap.docs.map((d) => [d.id, d.data()]));

  for (const [accountId, target] of Object.entries(ACCOUNT_TARGETS)) {
    const current = accountById.get(accountId);
    if (!current) {
      console.warn(`AVISO: conta ${accountId} não encontrada — alvo ignorado.`);
      continue;
    }
    const update = {};
    if (target.name && current.name !== target.name) update.name = target.name;
    if (target.group && current.group !== target.group) update.group = target.group;
    if (target.active === false && current.active !== false) update.active = false;
    if (target.searchTerms) {
      const terms = target.searchTerms.slice(0, 20);
      if (JSON.stringify(current.searchTerms ?? null) !== JSON.stringify(terms)) update.searchTerms = terms;
    }
    if (target.description && current.description !== target.description) update.description = target.description;
    if (Object.keys(update).length === 0) continue;
    log('conta', `${current.name} (${accountId}) → ${Object.keys(update).join(', ')}`);
    if (APPLY) await fin.collection('accounts').doc(accountId).update(update);
  }

  for (const { id, data } of NEW_ACCOUNTS) {
    if (accountById.has(id)) continue;
    const siblings = accountsSnap.docs.filter((d) => d.data().parentId === data.parentId).length;
    log('conta nova', `${data.name} (${id})`);
    if (APPLY) await fin.collection('accounts').doc(id).set({ ...data, order: siblings, isGroup: false });
  }

  // 1b) isGroup: as Rules do financeiro usam este flag para barrar despesa em
  // conta-grupo (Rules não conseguem consultar filhas). true = tem filhas.
  const parents = new Set(accountsSnap.docs.map((d) => d.data().parentId).filter(Boolean));
  for (const doc of accountsSnap.docs) {
    const target = parents.has(doc.id);
    if (doc.data().isGroup === target) continue;
    log('isGroup', `${doc.data().name} (${doc.id}) → ${target}`);
    if (APPLY) await doc.ref.update({ isGroup: target });
  }

  // 2) Despesas: reparos pontuais + varredura por contas órfãs
  const expensesSnap = await fin.collection('expenses').get();
  for (const doc of expensesSnap.docs) {
    const e = doc.data();
    const accRef = e.accountId ?? e.accountPlan;
    const fix = EXPENSE_FIXES[doc.id] ?? ORPHAN_REMAP[accRef];
    if (!fix || accRef === fix.id) continue;
    const update = { accountPlanName: fix.name };
    if ('accountId' in e) update.accountId = fix.id;
    if ('accountPlan' in e) update.accountPlan = fix.id;
    log('despesa', `${doc.id} (${e.description ?? ''}) → ${fix.name}`);
    if (APPLY) await doc.ref.update(update);
  }

  // 3) Pedidos de compra: reparos pontuais + órfãs (inclui frete)
  const ordersSnap = await est.collection('purchase_orders').get();
  for (const doc of ordersSnap.docs) {
    const o = doc.data();
    const update = {};
    const fix = ORDER_FIXES[doc.id] ?? ORPHAN_REMAP[o.accountPlanId];
    if (fix && o.accountPlanId !== fix.id) {
      update.accountPlanId = fix.id;
      update.accountPlanName = fix.name;
    }
    const freightFix = ORPHAN_REMAP[o.freightAccountPlanId];
    if (freightFix && o.freightAccountPlanId !== freightFix.id) {
      update.freightAccountPlanId = freightFix.id;
      update.freightAccountPlanName = freightFix.name;
    }
    if (Object.keys(update).length === 0) continue;
    log('pedido', `${doc.id} (${o.supplierName ?? 's/ fornecedor'}) → ${update.accountPlanName ?? update.freightAccountPlanName}`);
    if (APPLY) await doc.ref.update(update);
  }

  // 4) purchase_financials: órfãs
  const pfSnap = await est.collection('purchase_financials').get();
  for (const doc of pfSnap.docs) {
    const p = doc.data();
    const update = {};
    const fix = ORPHAN_REMAP[p.accountPlanId] ?? (ORDER_FIXES[p.purchaseOrderId] && p.accountPlanId ? ORDER_FIXES[p.purchaseOrderId] : null);
    if (fix && p.accountPlanId !== fix.id) {
      update.accountPlanId = fix.id;
      update.accountPlanName = fix.name;
    }
    const freightFix = ORPHAN_REMAP[p.freightAccountPlanId];
    if (freightFix && p.freightAccountPlanId !== freightFix.id) {
      update.freightAccountPlanId = freightFix.id;
      update.freightAccountPlanName = freightFix.name;
    }
    if (Object.keys(update).length === 0) continue;
    log('financeiro-compra', `${doc.id} (pedido ${p.purchaseOrderId}) → ${update.accountPlanName ?? update.freightAccountPlanName}`);
    if (APPLY) await doc.ref.update(update);
  }

  console.log(`\n${APPLY ? 'Aplicadas' : 'Previstas'} ${changes} alterações.`);
  if (!APPLY) console.log('Rode com --apply para gravar.');
}

await run();
