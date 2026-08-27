"use client";

import { BookOpen, Shirt } from "lucide-react";

import type { InstructionSection } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type UniformInstructionsItem = {
  productName?: string | null;
  apparelType?: string | null;
  apparelColor?: string | null;
  apparelSize?: string | null;
  imageUrl?: string | null;
  uniformCareInstructions?: InstructionSection[] | null;
};

function cleanInstructions(sections?: InstructionSection[] | null) {
  return (sections ?? [])
    .map((section) => ({
      ...section,
      name: String(section.name ?? "").trim(),
      etapas: (section.etapas ?? [])
        .map((step) => ({ ...step, text: String(step.text ?? "").trim() }))
        .filter((step) => step.text),
    }))
    .filter((section) => section.name || section.etapas.length > 0);
}

export function hasUniformCareInstructions(item?: UniformInstructionsItem | null) {
  return cleanInstructions(item?.uniformCareInstructions).some((section) => section.etapas.length > 0);
}

function itemDetails(item: UniformInstructionsItem) {
  return [
    item.apparelType,
    item.apparelColor,
    item.apparelSize ? `Tam. ${item.apparelSize}` : null,
  ].filter(Boolean).join(" · ");
}

export function UniformInstructionsDialog({
  item,
  open,
  onOpenChange,
}: {
  item: UniformInstructionsItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sections = cleanInstructions(item?.uniformCareInstructions);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Instruções do uniforme</DialogTitle>
          <DialogDescription>{item?.productName || "Uniforme"}</DialogDescription>
        </DialogHeader>

        {item ? (
          <div className="flex items-start gap-3 rounded-2xl border bg-slate-50 p-3">
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt={item.productName ?? "Uniforme"}
                className="h-14 w-14 rounded-xl border bg-white object-cover"
                loading="lazy"
              />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-xl border bg-white text-slate-400">
                <Shirt className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-900">{item.productName}</p>
              {itemDetails(item) ? (
                <p className="mt-1 text-xs font-semibold text-slate-500">{itemDetails(item)}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {sections.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-slate-50 p-6 text-center">
            <BookOpen className="mx-auto h-6 w-6 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-500">
              Nenhuma instrução cadastrada para esta peça.
            </p>
          </div>
        ) : (
          <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
            {sections.map((section, sectionIndex) => (
              <section key={section.id || sectionIndex} className="rounded-2xl border bg-white p-4">
                <p className="text-xs font-black uppercase text-slate-400">Seção {sectionIndex + 1}</p>
                <h3 className="mt-1 text-base font-black text-slate-900">
                  {section.name || "Instruções"}
                </h3>
                {section.etapas.length > 0 ? (
                  <ol className="mt-3 space-y-2">
                    {section.etapas.map((step, stepIndex) => (
                      <li key={step.id || stepIndex} className="flex gap-3 text-sm font-semibold leading-relaxed text-slate-700">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fff0f6] text-xs font-black text-[#df2f78]">
                          {stepIndex + 1}
                        </span>
                        <span>{step.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-slate-400">Sem passos cadastrados.</p>
                )}
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
