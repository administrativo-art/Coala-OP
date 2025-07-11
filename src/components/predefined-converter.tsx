
"use client"

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit, Trash2, ClipboardList, ListPlus, Save } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { useStockCount } from '@/hooks/use-stock-count';
import { type PredefinedList } from '@/types';
import { AddEditPredefinedListModal } from './add-edit-predefined-list-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PredefinedListItemConverter } from './predefined-list-item-converter';
import { Skeleton } from './ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Separator } from './ui/separator';

export function PredefinedConverter() {
  const { products, loading: productsLoading, getProductFullName } = useProducts();
  const { lists, loading: listsLoading, addList, updateList, deleteList } = usePredefinedLists();
  const { addStockCount } = useStockCount();
  const { permissions, user } = useAuth();
  const { toast } = useToast();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [listToEdit, setListToEdit] = useState<PredefinedList | null>(null);
  const [listToDelete, setListToDelete] = useState<PredefinedList | null>(null);
  const [listValues, setListValues] = useState<Record<string, Record<string, { value: string; result: string }>>>({});

  useEffect(() => {
    // Initialize state when lists are loaded
    if (!listsLoading) {
      const initialValues: typeof listValues = {};
      lists.forEach(list => {
        initialValues[list.id] = {};
        list.items.forEach(item => {
          initialValues[list.id][item.id] = { value: '1', result: '...' };
        });
      });
      setListValues(initialValues);
    }
  }, [lists, listsLoading]);


  const handleAddNew = () => {
    setListToEdit(null);
    setIsModalOpen(true);
  };

  const handleEdit = (list: PredefinedList) => {
    setListToEdit(list);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (list: PredefinedList) => {
    setListToDelete(list);
  };

  const handleDeleteConfirm = async () => {
    if (listToDelete) {
      await deleteList(listToDelete.id);
      setListToDelete(null);
    }
  };

  const handleValueChange = (listId: string, itemId: string, value: string, result: string) => {
    setListValues(prev => ({
      ...prev,
      [listId]: {
        ...prev[listId],
        [itemId]: { value, result },
      }
    }));
  };

  const handleSaveCount = (list: PredefinedList) => {
    if (!user) return;
    const values = listValues[list.id];
    const items = list.items.map(item => {
        const product = products.find(p => p.id === item.productId);
        return {
            productId: item.productId,
            productName: product ? getProductFullName(product) : 'Produto desconhecido',
            fromUnit: item.fromUnit,
            toUnit: item.toUnit,
            value: values[item.id]?.value || '0',
            result: values[item.id]?.result || '0',
        };
    });

    addStockCount({
        listId: list.id,
        listName: list.name,
        userId: user.id,
        username: user.username,
        kioskId: user.assignedKioskIds[0] || 'N/A', // Assuming primary kiosk
        createdAt: new Date().toISOString(),
        items,
    });
    
    toast({
        title: "Contagem salva!",
        description: `A contagem "${list.name}" foi salva no histórico.`,
    });
  };

  const renderContent = () => {
    if (listsLoading || productsLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      );
    }

    if (lists.length === 0) {
      return (
        <div className="text-center py-8 flex flex-col items-center">
            <ClipboardList className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-semibold">Nenhum modelo de contagem criado</h3>
            <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                Crie modelos de contagem para agilizar as tarefas do dia a dia.
            </p>
            <Button size="lg" onClick={handleAddNew} disabled={!permissions.predefinedLists.add}>
                <ListPlus className="mr-2 h-5 w-5" /> Criar seu primeiro modelo
            </Button>
        </div>
      );
    }

    return (
      <Accordion type="single" collapsible className="w-full space-y-2">
        {lists.map(list => (
          <AccordionItem value={list.id} key={list.id} className="border-none">
            <Card>
              <AccordionTrigger className="p-4 hover:no-underline rounded-lg">
                  <div className="flex justify-between items-center w-full">
                    <span className="text-lg font-semibold">{list.name}</span>
                    <div className="flex items-center gap-1">
                        {permissions.predefinedLists.edit && (
                          <Button asChild variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEdit(list); }}>
                              <span><Edit className="h-4 w-4" /></span>
                          </Button>
                        )}
                        {permissions.predefinedLists.delete && (
                          <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteClick(list); }}>
                               <span><Trash2 className="h-4 w-4" /></span>
                          </Button>
                        )}
                    </div>
                  </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="p-4 pt-0 space-y-4">
                  {list.items.length > 0 ? (
                    <>
                      {list.items.map(item => (
                        <PredefinedListItemConverter 
                          key={item.id}
                          item={item}
                          products={products}
                          value={listValues[list.id]?.[item.id]?.value ?? '1'}
                          onValueChange={(v, r) => handleValueChange(list.id, item.id, v, r)}
                        />
                      ))}
                      <Separator />
                      <div className="flex justify-end">
                        <Button onClick={() => handleSaveCount(list)}>
                            <Save className="mr-2" />
                            Salvar Contagem
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">Este modelo de contagem está vazio.</p>
                  )}
                </div>
              </AccordionContent>
            </Card>
          </AccordionItem>
        ))}
      </Accordion>
    );
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
            <ClipboardList /> Contagem de Estoque
          </CardTitle>
          <CardDescription className="text-center">Use modelos de contagem para agilizar as tarefas comuns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {permissions.predefinedLists.add && (
            <Button onClick={handleAddNew} className="w-full">
                <ListPlus className="mr-2 h-4 w-4" /> Criar novo modelo de contagem
            </Button>
          )}
          <div className="mt-6">
            {renderContent()}
          </div>
        </CardContent>
      </Card>

      <AddEditPredefinedListModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        listToEdit={listToEdit}
        addList={addList}
        updateList={updateList}
        products={products}
        getProductFullName={getProductFullName}
      />
      
      {listToDelete && (
        <DeleteConfirmationDialog
          open={!!listToDelete}
          onOpenChange={() => setListToDelete(null)}
          onConfirm={handleDeleteConfirm}
          itemName={`o modelo "${listToDelete.name}"`}
        />
      )}
    </>
  );
}
