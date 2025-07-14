"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListPlus, PackagePlus } from "lucide-react";
import { StockAnalysisConfigurator } from "./stock-analysis-configurator";
import { ProductManagement } from "./product-management";
import { Button } from "./ui/button";
import { PlusCircle } from "lucide-react";
import { useStockAnalysisProducts } from "@/hooks/use-stock-analysis-products";
import { useProducts } from "@/hooks/use-products";
import { useToast } from "@/hooks/use-toast";

export function RegistrationManagement() {
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState(null);
  
  // Logic moved from child to parent
  const { analysisProducts, loading, addAnalysisProduct, deleteAnalysisProduct } = useStockAnalysisProducts();
  const { products } = useProducts();
  const { toast } = useToast();
  const [newCategoryName, setNewCategoryName] = useState('');

  const handleAddNewProduct = () => {
    setProductToEdit(null);
    setIsProductModalOpen(true);
  };
  
  const handleAddCategory = async () => {
    if (newCategoryName.trim()) {
      await addAnalysisProduct({ itemName: newCategoryName.trim() });
      setNewCategoryName('');
    }
  };
  
  const handleDeleteCategory = async (id: string) => {
    const isUsed = products.some(p => p.analysisProductId === id);
    if (isUsed) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: "Esta categoria está sendo usada por um ou mais insumos e não pode ser excluída.",
      });
      return;
    }
    await deleteAnalysisProduct(id);
  };

  return (
    <>
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
                <div className="flex justify-end p-1">
                    <Button onClick={handleAddNewProduct}>
                        <PlusCircle className="mr-2" /> Adicionar Novo Insumo
                    </Button>
                </div>
              </TabsContent>
              <TabsContent value="categories" className="mt-4">
                  <StockAnalysisConfigurator
                    analysisProducts={analysisProducts}
                    loading={loading}
                    newCategoryName={newCategoryName}
                    setNewCategoryName={setNewCategoryName}
                    onAddCategory={handleAddCategory}
                    onDeleteCategory={handleDeleteCategory}
                  />
              </TabsContent>
          </Tabs>
      </div>
      <ProductManagement 
        open={isProductModalOpen}
        onOpenChange={setIsProductModalOpen}
        productToEdit={productToEdit}
      />
    </>
  )
}
