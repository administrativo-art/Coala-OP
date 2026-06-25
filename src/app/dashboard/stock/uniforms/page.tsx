"use client";

import { Shirt } from "lucide-react";

import { UniformManagement } from "@/components/uniform-management";
import { BackButton } from "@/components/navigation/back-button";

export default function UniformsPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)] space-y-7 rounded-[28px] bg-[var(--bg)] p-5 sm:p-7">
      <div className="flex items-start gap-4">
        <BackButton
          fallbackHref="/dashboard/stock"
          variant="ghost"
          iconOnly
          className="mt-2 h-10 w-10 rounded-full p-0 text-[#8f8f9b] hover:bg-white"
          ariaLabel="Voltar para gestão de estoque"
        />
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[20px] bg-[#fdeaf3] text-[#d9275f]">
            <Shirt className="h-8 w-8" />
          </div>
          <div className="min-w-0 pt-1">
            <h1 className="text-3xl font-black leading-tight text-[#171820] sm:text-4xl">
              Controle de Uniformes
            </h1>
            <p className="mt-2 max-w-4xl text-base font-semibold text-[#747480] sm:text-lg">
              Consulte peças novas, usadas, entregas, devoluções e peças em posse dos colaboradores.
            </p>
          </div>
        </div>
      </div>
      <UniformManagement />
    </div>
  );
}
