
import { InventoryConverter } from "@/components/inventory-converter"

export function MeasureConverter() {
  return (
    <div className="w-full">
        <div className="mb-6">
            <h1 className="text-3xl font-bold">Conversão de medidas</h1>
            <p className="text-muted-foreground">Converta unidades de inventário com base nos seus produtos cadastrados.</p>
        </div>
        <InventoryConverter />
    </div>
  )
}
