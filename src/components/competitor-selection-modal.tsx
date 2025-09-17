
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useCompetitors } from '@/hooks/use-competitors';
import { type Competitor, type CompetitorGroup } from '@/types';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Building, Search } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';

interface CompetitorSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCompetitorIds: string[];
  setSelectedCompetitorIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function CompetitorSelectionModal({ isOpen, onClose, selectedCompetitorIds, setSelectedCompetitorIds }: CompetitorSelectionModalProps) {
  const { competitors, competitorGroups } = useCompetitors();
  const [internalSelection, setInternalSelection] = useState<Set<string>>(new Set());

  useEffect(() => {
    if(isOpen) {
        setInternalSelection(new Set(selectedCompetitorIds));
    }
  }, [isOpen, selectedCompetitorIds]);

  const groupedCompetitors = useMemo(() => {
    return competitorGroups.map(group => ({
      ...group,
      competitors: competitors.filter(c => c.competitorGroupId === group.id)
    })).filter(group => group.competitors.length > 0);
  }, [competitorGroups, competitors]);

  const handleSelectGroup = (groupId: string, checked: boolean) => {
    const groupCompetitorIds = competitors
      .filter(c => c.competitorGroupId === groupId)
      .map(c => c.id);

    setInternalSelection(prev => {
        const newSet = new Set(prev);
        if (checked) {
            groupCompetitorIds.forEach(id => newSet.add(id));
        } else {
            groupCompetitorIds.forEach(id => newSet.delete(id));
        }
        return newSet;
    });
  };

  const handleSelectCompetitor = (competitorId: string, checked: boolean) => {
      setInternalSelection(prev => {
          const newSet = new Set(prev);
          if (checked) {
              newSet.add(competitorId);
          } else {
              newSet.delete(competitorId);
          }
          return newSet;
      });
  };

  const handleConfirm = () => {
    setSelectedCompetitorIds(Array.from(internalSelection));
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Selecionar Concorrentes para Análise</DialogTitle>
          <DialogDescription>
            Escolha os concorrentes que você deseja incluir na tabela de comparação de preços.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto -mx-6 px-6">
            <ScrollArea className="h-full pr-2">
                <Accordion type="multiple" className="w-full space-y-2">
                    {groupedCompetitors.map(group => {
                        const allInGroupSelected = group.competitors.every(c => internalSelection.has(c.id));
                        const someInGroupSelected = group.competitors.some(c => internalSelection.has(c.id));

                        return (
                            <AccordionItem value={group.id} key={group.id} className="border rounded-lg">
                                <div className="flex items-center p-3">
                                    <div className="flex items-center space-x-3 flex-shrink-0 pr-2">
                                        <Checkbox
                                            id={`group-${group.id}`}
                                            checked={allInGroupSelected || (someInGroupSelected ? 'indeterminate' : false)}
                                            onCheckedChange={(checked) => handleSelectGroup(group.id, !!checked)}
                                        />
                                        <Label htmlFor={`group-${group.id}`} className="font-semibold text-base cursor-pointer">
                                            {group.name}
                                        </Label>
                                    </div>
                                    <AccordionTrigger className="p-0 hover:no-underline flex-1 justify-end" />
                                </div>
                                <AccordionContent className="p-3 pt-0">
                                    <div className="space-y-2 pl-8">
                                        {group.competitors.map(competitor => (
                                            <div key={competitor.id} className="flex items-center space-x-3">
                                                <Checkbox
                                                    id={`comp-${competitor.id}`}
                                                    checked={internalSelection.has(competitor.id)}
                                                    onCheckedChange={(checked) => handleSelectCompetitor(competitor.id, !!checked)}
                                                />
                                                <Label htmlFor={`comp-${competitor.id}`} className="font-normal cursor-pointer">
                                                    {competitor.name}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        )
                    })}
                </Accordion>
            </ScrollArea>
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleConfirm}>Confirmar Seleção ({internalSelection.size})</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
