import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type CashFlowStepState = "done" | "current" | "upcoming";

type CashFlowStepperProps = {
  current?: number;
  completedThrough?: number;
  className?: string;
};

const STEPS = [
  ["Fechamento no PDV", "sincronizado"],
  ["Conferência do Caixa e Financeiro", "valores e contagem física"],
  ["Finalização do operador", "por turno"],
  ["Composição física", "cédulas e moedas"],
  ["Emissão do depósito", "boleto bancário"],
  ["Pagamento", "liquidação"],
] as const;

function stepState(index: number, current: number, completedThrough: number): CashFlowStepState {
  if (index < completedThrough) return "done";
  if (index === current) return "current";
  return "upcoming";
}

export function CashFlowStepper({ current = 0, completedThrough = 0, className }: CashFlowStepperProps) {
  return (
    <div className={cn("grid gap-3 rounded-2xl border border-stone-200 bg-[#fffefb] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6", className)}>
      {STEPS.map(([label, hint], index) => {
        const state = stepState(index, current, completedThrough);
        return (
          <div key={label} className="flex min-w-0 items-center gap-2.5">
            <span className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black",
              state === "done" && "bg-emerald-600 text-white",
              state === "current" && "bg-pink-600 text-white",
              state === "upcoming" && "bg-stone-100 text-zinc-400",
            )}>
              {state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-[11.5px] font-extrabold leading-tight", state === "upcoming" ? "text-zinc-400" : "text-zinc-800")}>{label}</span>
              <span className="mt-0.5 block text-[10.5px] font-semibold leading-tight text-zinc-400">{hint}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
