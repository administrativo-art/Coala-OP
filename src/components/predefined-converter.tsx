"use client"

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Edit, Trash2, ClipboardList, ListPlus, Wand2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useProducts } from '@/hooks/use-products';
import { usePredefinedLists } from '@/hooks/use-predefined-lists';
import { type PredefinedList } from '@/types';
import { AddEditPredefinedListModal } from './add-edit-predefined-list-modal';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PredefinedListItemConverter } from './predefined-list-item-converter';
import { Skeleton } from './ui/skeleton';

export function PredefinedConverter() {
  const { products, loading: productsLoading, getProductFullName } = useProducts();
  const { lists, loading: listsLoading, addList, updateList, deleteList } = usePredefinedLists();
  const { permissions } = useAuth();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [listToEdit, setListToEdit] = useState<PredefinedList | null>(null);
  const [listToDelete, setListToDelete] = useState<PredefinedList | null>(null);

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

  const handleDeleteConfirm = () => {
    if (listToDelete) {
      deleteList(listToDelete.id);
      setListToDelete(null);
    }
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
            <Wand2 className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="text-xl font-semibold">Nenhuma lista predefinida criada</h3>
            <p className="text-muted-foreground mt-2 mb-6 max-w-sm">
                Crie listas de conversões rápidas para agilizar as tarefas do dia a dia.
            </p>
            <Button size="lg" onClick={handleAddNew} disabled={!permissions.predefinedLists.add}>
                <ListPlus className="mr-2 h-5 w-5" /> Criar sua primeira lista
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
                        <Button asChild variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleEdit(list); }} disabled={!permissions.predefinedLists.edit}>
                            <span>
                                <Edit className="h-4 w-4" />
                            </span>
                        </Button>
                        <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleDeleteClick(list); }} disabled={!permissions.predefinedLists.delete}>
                             <span>
                                <Trash2 className="h-4 w-4" />
                            </span>
                        </Button>
                    </div>
                  </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="p-4 pt-0 space-y-4">
                  {list.items.length > 0 ? list.items.map(item => (
                    <PredefinedListItemConverter 
                      key={item.id}
                      item={item}
                      products={products}
                    />
                  )) : (
                    <p className="text-sm text-muted-foreground text-center py-4">Esta lista está vazia.</p>
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
      <Card className="w-full max-w-4xl mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
            <ClipboardList /> Conversão Predefinida
          </CardTitle>
          <CardDescription className="text-center">Use listas de conversão rápida para as tarefas comuns.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <Button onClick={handleAddNew} className="w-full" disabled={!permissions.predefinedLists.add}>
              <ListPlus className="mr-2 h-4 w-4" /> Criar Nova Lista de Conversão
          </Button>
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
          itemName={`a lista "${listToDelete.name}"`}
        />
      )}
    </>
  );
}
