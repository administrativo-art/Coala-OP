"use client";

import { ItemManagement } from "./item-management";

export function RegistrationManagement() {
  return (
    <div className="w-full">
        <div className="mb-6">
            <h1 className="text-3xl font-bold">Cadastros</h1>
            <p className="text-muted-foreground">Gerencie os insumos (itens físicos) do seu estoque.</p>
        </div>
        <ItemManagement />
    </div>
  )
}
