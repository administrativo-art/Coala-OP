"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ListPlus, PackagePlus } from "lucide-react";
import { StockAnalysisConfigurator } from "./stock-analysis-configurator";
import { ProductManagement } from "./product-management";

export function RegistrationManagement() {
  return (
    <div className="w-full">
        <div className="mb-6">
            <h1 className="text-3xl font-bold">Cadastros</h1>
            <p className="text-muted-foreground">Gerencie as categorias de insumos e os próprios insumos do sistema.</p>
        </div>
        <Tabs defaultValue="products" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-lg">
                <TabsTrigger value="products"><PackagePlus className="mr-2 h-4 w-4" /> Cadastro de Insumos</TabsTrigger>
                <TabsTrigger value="categories"><ListPlus className="mr-2 h-4 w-4" /> Cadastro de Categorias</TabsTrigger>
            </TabsList>
            <TabsContent value="products" className="mt-4">
               <ProductManagement />
            </TabsContent>
            <TabsContent value="categories" className="mt-4">
                <StockAnalysisConfigurator />
            </TabsContent>
        </Tabs>
    </div>
  )
}
