import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InventoryConverter } from "@/components/inventory-converter"
import { PredefinedConverter } from "@/components/predefined-converter"
import { ArrowLeftRight, ClipboardList } from "lucide-react"

export function MeasureConverter() {
  return (
    <div className="w-full">
        <div className="mb-6">
            <h1 className="text-3xl font-bold">Conversão de Medidas</h1>
            <p className="text-muted-foreground">Ferramentas para converter unidades de inventário e usar listas rápidas.</p>
        </div>
        <Tabs defaultValue="inventory" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-lg">
                <TabsTrigger value="inventory"><ArrowLeftRight className="mr-2 h-4 w-4" /> Conversão de Inventário</TabsTrigger>
                <TabsTrigger value="predefined"><ClipboardList className="mr-2 h-4 w-4" /> Contagem de Estoque</TabsTrigger>
            </TabsList>
            <TabsContent value="inventory" className="mt-4">
                <InventoryConverter />
            </TabsContent>
            <TabsContent value="predefined" className="mt-4">
                <PredefinedConverter />
            </TabsContent>
        </Tabs>
    </div>
  )
}
