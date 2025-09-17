
"use client";

import React, { useState, useMemo } from 'react';
import { useCompetitors } from '@/hooks/use-competitors';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusCircle, Edit, Trash2, Building, Search } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ScrollArea } from './ui/scroll-area';
import { type Competitor, type CompetitorGroup } from '@/types';
import { AddEditCompetitorModal } from './add-edit-competitor-modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

function CompetitorGroupManager() {
    const { competitorGroups, addCompetitorGroup, updateCompetitorGroup, deleteCompetitorGroup, competitors } = useCompetitors();
    const [newGroupName, setNewGroupName] = useState('');
    const [editingGroup, setEditingGroup] = useState<CompetitorGroup | null>(null);
    const [groupToDelete, setGroupToDelete] = useState<CompetitorGroup | null>(null);

    const handleAddOrUpdate = async () => {
        if (!newGroupName.trim()) return;
        if (editingGroup) {
            await updateCompetitorGroup(editingGroup.id, { ...editingGroup, name: newGroupName });
            setEditingGroup(null);
        } else {
            await addCompetitorGroup({ name: newGroupName });
        }
        setNewGroupName('');
    };
    
    const handleDeleteConfirm = () => {
        if (groupToDelete) {
            deleteCompetitorGroup(groupToDelete.id);
            setGroupToDelete(null);
        }
    };

    const competitorCountByGroup = useMemo(() => {
        return competitors.reduce((acc, curr) => {
            if (curr.competitorGroupId) {
                acc[curr.competitorGroupId] = (acc[curr.competitorGroupId] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
    }, [competitors]);

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <Input
                    placeholder={editingGroup ? `Renomear "${editingGroup.name}"` : "Nome do novo grupo"}
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                />
                <Button onClick={handleAddOrUpdate}>
                    {editingGroup ? 'Salvar' : <PlusCircle className="h-4 w-4" />}
                </Button>
                {editingGroup && <Button variant="outline" onClick={() => { setEditingGroup(null); setNewGroupName(''); }}>Cancelar</Button>}
            </div>
             <ScrollArea className="h-[calc(70vh-200px)]">
                <div className="space-y-2 pr-4">
                    {competitorGroups.map(group => (
                        <div key={group.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div>
                                <p className="font-semibold">{group.name}</p>
                                <p className="text-sm text-muted-foreground">{competitorCountByGroup[group.id] || 0} unidade(s)</p>
                            </div>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => { setEditingGroup(group); setNewGroupName(group.name); }}><Edit className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setGroupToDelete(group)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>
             <DeleteConfirmationDialog 
                open={!!groupToDelete}
                onOpenChange={() => setGroupToDelete(null)}
                onConfirm={handleDeleteConfirm}
                itemName={`o grupo "${groupToDelete?.name}"`}
                description="Atenção: Excluir um grupo também excluirá permanentemente TODAS as unidades de concorrentes (e seus produtos e preços) associadas a ele. Esta ação não pode ser desfeita."
            />
        </div>
    )
}

function CompetitorUnitManager({ onEdit }: { onEdit: (competitor: Competitor) => void }) {
    const { competitors, loading, deleteCompetitor, competitorGroups } = useCompetitors();
    const [competitorToDelete, setCompetitorToDelete] = useState<Competitor | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const groupMap = useMemo(() => new Map(competitorGroups.map(g => [g.id, g.name])), [competitorGroups]);

    const filteredCompetitors = useMemo(() => {
        if (!searchTerm) return competitors;
        return competitors.filter(c => 
            c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (groupMap.get(c.competitorGroupId || '') || '').toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [competitors, searchTerm, groupMap]);

    const handleDeleteConfirm = () => {
        if (competitorToDelete) {
            deleteCompetitor(competitorToDelete.id);
            setCompetitorToDelete(null);
        }
    };

     return (
        <div className="space-y-4">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar por unidade ou grupo..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                />
            </div>
            <ScrollArea className="h-[calc(70vh-200px)]">
                {loading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                    </div>
                ) : (
                    <div className="space-y-2 pr-4">
                        {filteredCompetitors.map(c => {
                            const groupName = c.competitorGroupId ? groupMap.get(c.competitorGroupId) : 'Sem Grupo';
                            const addressParts = [c.address, c.city, c.state].filter(Boolean);
                            const fullAddress = addressParts.length > 0 ? `${c.address ? c.address + ', ' : ''}${c.city ? c.city + ' - ' : ''}${c.state || ''}` : '';
                            
                            return (
                                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <Building className="h-5 w-5 text-muted-foreground" />
                                        <div>
                                            <p className="font-semibold">{c.name}</p>
                                            <p className="text-sm text-muted-foreground">{groupName} - {fullAddress || 'Endereço não informado'}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => onEdit(c)}><Edit className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setCompetitorToDelete(c)}><Trash2 className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </ScrollArea>
             <DeleteConfirmationDialog 
                open={!!competitorToDelete}
                onOpenChange={() => setCompetitorToDelete(null)}
                onConfirm={handleDeleteConfirm}
                itemName={`o concorrente "${competitorToDelete?.name}"`}
                description="Esta ação também excluirá permanentemente todos os produtos e preços associados a este concorrente."
            />
        </div>
    )
}

export function CompetitorManagementModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCompetitor, setEditingCompetitor] = useState<Competitor | null>(null);

  const handleAddNew = () => {
    setEditingCompetitor(null);
    setIsFormModalOpen(true);
  };
  
  const handleStartEdit = (competitor: Competitor) => {
    setEditingCompetitor(competitor);
    setIsFormModalOpen(true);
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Gerenciamento de Concorrência</DialogTitle>
                <DialogDescription>Adicione, edite e gerencie seus concorrentes e grupos.</DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="units" className="flex-grow overflow-hidden">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="units">Concorrentes (Unidades)</TabsTrigger>
                    <TabsTrigger value="groups">Grupos de Concorrentes</TabsTrigger>
                </TabsList>
                <TabsContent value="units" className="space-y-4 pt-4">
                     <Button onClick={handleAddNew} className="w-full">
                        <PlusCircle className="mr-2 h-4 w-4" /> Adicionar nova unidade concorrente
                    </Button>
                    <CompetitorUnitManager onEdit={handleStartEdit} />
                </TabsContent>
                 <TabsContent value="groups" className="pt-4">
                    <CompetitorGroupManager />
                </TabsContent>
            </Tabs>
             <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={onClose}>Fechar</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    {isFormModalOpen && (
        <AddEditCompetitorModal
            isOpen={isFormModalOpen}
            onClose={() => setIsFormModalOpen(false)}
            competitorToEdit={editingCompetitor}
        />
    )}
    </>
  );
}
