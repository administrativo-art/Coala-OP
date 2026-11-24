import type { ClosingCheck, ClosingFlow, ClosingItem } from "./types";

/** Dinheiro de um quiosque na competência, lido dos fechamentos de caixa diários. */
export type CashKioskInput = {
  key: string;
  label: string;
  closuresHref: string;
  depositsHref: string;
  /** Dias com fechamento de caixa no mês e quantos ainda não foram aprovados. */
  closureDays: number;
  openDays: number;
  /** Dias aprovados com dinheiro elegível a depositar e quantos ainda estão sem depósito pago ou ajustado (com o valor que falta). */
  depositDays: number;
  unpaidDays: number;
  unpaidCents: number;
};

/** `null` quando não foi possível ler os fechamentos de caixa. */
export type CashInput = { monthOver: boolean; kiosks: CashKioskInput[] } | null;

export type CashFlowInput = { cash: CashInput; canViewItems: boolean; originHref: string };

const CHECK_CLOSING = "cash.closing";
const CHECK_DEPOSIT = "cash.deposit";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Dinheiro, em duas conferências que só valem depois que o mês terminou:
 * 1. Fechamento do caixa: todo dia com fechamento de caixa aprovado, em todos os quiosques.
 * 2. Depósito do dinheiro: todo dia aprovado com dinheiro elegível com depósito pago ou ajustado (o ajuste é feito na tela
 *    de depósitos e conta como resolvido). Só fecha com todos os dias aprovados, porque dia aberto ainda pode gerar depósito.
 * Sem os fechamentos lidos, ou sem nenhum fechamento no mês, nada é dado como conferido.
 */
export function evaluateCashFlow(input: CashFlowInput): ClosingFlow {
  const { cash } = input;
  const unavailable = (id: string, name: string): ClosingCheck => ({ id, name, state: "unavailable", done: null, total: null, note: "Não foi possível ler os fechamentos de caixa agora. Tente de novo." });
  const items: ClosingItem[] = [];
  let checks: ClosingCheck[];
  if (!cash) {
    checks = [unavailable(CHECK_CLOSING, "Fechamento do caixa"), unavailable(CHECK_DEPOSIT, "Depósito do dinheiro")];
  } else if (!cash.monthOver) {
    const note = "Confere depois que o mês terminar.";
    checks = [
      { id: CHECK_CLOSING, name: "Fechamento do caixa", state: "pending", done: null, total: null, note },
      { id: CHECK_DEPOSIT, name: "Depósito do dinheiro", state: "pending", done: null, total: null, note },
    ];
  } else {
    const total = (pick: (kiosk: CashKioskInput) => number) => cash.kiosks.reduce((acc, kiosk) => acc + pick(kiosk), 0);
    const closureDays = total((kiosk) => kiosk.closureDays);
    const openDays = total((kiosk) => kiosk.openDays);
    const depositDays = total((kiosk) => kiosk.depositDays);
    const unpaidDays = total((kiosk) => kiosk.unpaidDays);
    for (const kiosk of cash.kiosks) {
      if (kiosk.openDays > 0) {
        items.push({
          id: `cash:${kiosk.key}:closing`, checkId: CHECK_CLOSING, kind: "cash_closing_open", tone: "warn", title: kiosk.label,
          detail: plural(kiosk.openDays, "dia com fechamento de caixa não aprovado", "dias com fechamento de caixa não aprovado"),
          dueDate: null, amountCents: null, href: kiosk.closuresHref,
        });
      }
      if (kiosk.unpaidDays > 0) {
        items.push({
          id: `cash:${kiosk.key}:deposit`, checkId: CHECK_DEPOSIT, kind: "cash_deposit_unpaid", tone: "warn", title: kiosk.label,
          detail: plural(kiosk.unpaidDays, "dia com dinheiro ainda sem depósito pago", "dias com dinheiro ainda sem depósito pago"),
          dueDate: null, amountCents: kiosk.unpaidCents, href: kiosk.depositsHref,
        });
      }
    }
    const empty = closureDays === 0;
    checks = [
      {
        id: CHECK_CLOSING, name: "Fechamento do caixa", state: !empty && openDays === 0 ? "ok" : "pending", done: closureDays - openDays, total: closureDays,
        ...(empty ? { note: "Nenhum fechamento de caixa lido neste mês." } : {}),
      },
      {
        id: CHECK_DEPOSIT, name: "Depósito do dinheiro", state: !empty && openDays === 0 && unpaidDays === 0 ? "ok" : "pending", done: depositDays - unpaidDays, total: depositDays,
        ...(empty ? { note: "Nenhum fechamento de caixa lido neste mês." } : openDays > 0 ? { note: "Aguarda a aprovação de todos os dias do caixa." } : {}),
      },
    ];
  }
  const state = checks.some((check) => check.state === "pending") ? "pending"
    : checks.some((check) => check.state === "unavailable") ? "unavailable" : "ok";
  return {
    key: "cash", name: "Recebimento · Dinheiro", state, checks,
    items: input.canViewItems ? items : [], itemsHidden: !input.canViewItems && items.length > 0,
    readyFrom: null, originHref: input.originHref,
  };
}
