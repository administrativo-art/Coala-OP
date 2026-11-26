import type { DreExpenseCalculation } from "../lib/dre-expense-calculation";
import type { DreCmvPeriod } from "./cmv-closure";
import type { DreCmvCriterion, DreStockCmvSelection } from "./stock-cmv";
import { aggregateDreRevenue } from "./revenue-selection";
import { dreResultState } from "../lib/dre-statement";

/** One arithmetic core for the screen and server-generated reports. */
export function calculateDreMetrics<T extends ReturnType<typeof aggregateDreRevenue>>(input: {
  expenseCalculation: DreExpenseCalculation;
  revenueSource: T;
  stockCmvBreakdown: DreStockCmvSelection;
  compositionCmv: number;
  cmvCriterion: DreCmvCriterion;
  compositionPeriods: DreCmvPeriod[];
}) {
    const { expenseCalculation } = input;
    const expenseAt = (position: string | null) => expenseCalculation.totalsByPosition[position ?? "null"] ?? 0;
    const { revenueSource, stockCmvBreakdown, compositionCmv, cmvCriterion, compositionPeriods } = input;
    const revBruta = (revenueSource.revenueCents ?? NaN) / 100;
    const cashShortage = (revenueSource.cashShortageCents ?? NaN) / 100;
    const cashSurplus = (revenueSource.cashSurplusCents ?? NaN) / 100;
    const impostos = expenseAt("impostos_deducoes");
    const recLiq = revBruta - impostos;

    const cmv = cmvCriterion === "stock_movement"
      ? stockCmvBreakdown.totalCmv
      : compositionCmv;
    const cmvForResult = cmvCriterion === "composition" && compositionPeriods.some(row => row.sourceChanged) ? NaN : cmv;
    const margBruta = recLiq - cmvForResult;

    const custVar = expenseAt("custos_variaveis");
    const margContr = margBruta - custVar;

    const pessoal = expenseAt("pessoal");
    const despOp = expenseAt("despesas_operacionais");
    const ocupacao = expenseAt("ocupacao");
    const semCategoria = expenseAt(null);
    const totalFixos = pessoal + despOp + ocupacao + semCategoria;
    const resOp = margContr - totalFixos - cashShortage + cashSurplus;

    const recFin = expenseAt("receita_financeira");
    const despFin = expenseAt("despesas_financeiras");
    const recNaoOp = expenseAt("receita_nao_operacional");
    const despNaoOp = expenseAt("despesa_nao_operacional");
    const lair = resOp + recFin - despFin + recNaoOp - despNaoOp;
    const irCsll = expenseAt("impostos_resultado");
    const lucroLiq = lair - irCsll;
    const resultState = dreResultState({ result: lucroLiq, cash: revenueSource,
      feeReasons: [...(revBruta > 0 ? ["Cobertura integral das taxas de cartão/PIX ainda não certificada nesta DRE; ausência de lançamento não comprova taxa zero."] : []), ...Object.values(expenseCalculation.detailsByPosition).flat().flatMap(line => [
        ...(line.feeRecognition?.estimated ? ["Há taxas de vendas estimadas por referência confirmada ou contrato; sujeitas à apuração na adquirente."] : []),
        ...(line.feeRecognition?.incomplete ? ["Há componentes de taxas pendentes de conciliação/apuração; pendência não representa custo zero."] : []),
      ])],
      compositionOpen: cmvCriterion === "composition" && compositionPeriods.some(row => row.status !== "closed") });

    const margContPct = !Number.isFinite(recLiq) ? NaN : recLiq > 0 ? margContr / recLiq : 0;
    const pe = !Number.isFinite(margContPct) ? NaN : margContPct > 0 ? totalFixos / margContPct : 0;

    return {
      revenueSource,
      cashShortage,
      cashSurplus,
      revBruta,
      impostos,
      recLiq,
      cmv,
      compositionCmv,
      stockCmvBreakdown,
      custVar,
      margBruta,
      margContr,
      pessoal,
      despOp,
      ocupacao,
      semCategoria,
      totalFixos,
      resOp,
      recFin,
      despFin,
      recNaoOp,
      despNaoOp,
      lair,
      irCsll,
      lucroLiq,
      resultState,
      pe,
      margContPct,
      expenseDetailsByPosition: expenseCalculation.detailsByPosition,
      expenseIssues: expenseCalculation.issues,
    };
}
