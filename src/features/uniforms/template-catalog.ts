import type { UniformTransactionType } from "@/types";

export const UNIFORM_SYSTEM_TEMPLATES = [
  {
    id: "system-uniform-delivery",
    type: "delivery",
    name: "Termo de entrega de uniforme",
    category: "Uniformes",
    description: "Registra a entrega e a responsabilidade pelas peças recebidas.",
  },
  {
    id: "system-uniform-exchange",
    type: "exchange",
    name: "Termo de troca de uniforme",
    category: "Uniformes",
    description: "Registra em um único documento a devolução e a nova entrega.",
  },
  {
    id: "system-uniform-return",
    type: "return",
    name: "Termo de devolução de uniforme",
    category: "Uniformes",
    description: "Registra a condição e o destino das peças devolvidas.",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  type: UniformTransactionType;
  name: string;
  category: string;
  description: string;
}>;

export function uniformSystemTemplateById(id: string) {
  return UNIFORM_SYSTEM_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function uniformSystemTemplateId(type: UniformTransactionType) {
  return UNIFORM_SYSTEM_TEMPLATES.find((template) => template.type === type)!.id;
}
