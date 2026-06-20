"use client";

import { Shirt } from "lucide-react";

import { UniformManagement } from "@/components/uniform-management";
import { BackButton } from "@/components/navigation/back-button";

export default function UniformsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <BackButton
          fallbackHref="/dashboard/stock"
          variant="ghost"
          iconOnly
          className="mt-1 h-auto w-auto rounded-full p-2 text-muted-foreground"
          ariaLabel="Voltar para gestão de estoque"
        />
        <div>
          <div className="flex items-center gap-2">
            <Shirt className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold">Controle de Uniformes</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte peças novas, usadas, em avaliação e em posse dos colaboradores.
          </p>
        </div>
      </div>
      <UniformManagement />
    </div>
  );
}
