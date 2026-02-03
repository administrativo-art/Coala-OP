"use client"

import { useState } from 'react';
import { AverageConsumptionChart } from "./average-consumption-chart";
import { ConsumptionHistoryModal } from './consumption-history-modal';
import { ConsumptionImportModal } from './consumption-import-modal';
import { Button } from './ui/button';
import { useValidatedConsumptionData } from '@/hooks/use-validated-consumption-data';
import { useKiosks } from '@/hooks/use-kiosks';
import { FileClock, Upload } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

export function ConsumptionAnalysisDashboard() {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const { reports, isLoading, addReport, deleteReport } = useValidatedConsumptionData();
  const { kiosks } = useKiosks();
  const { permissions } = useAuth();
  
  return (
    <div className="space-y-6">
        <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsHistoryOpen(true)}>
                <FileClock className="mr-2 h-4 w-4" />
                Histórico de Análises
            </Button>
            {permissions.stock.analysis.consumption && (
                 <Button onClick={() => setIsImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Importar Relatório
                </Button>
            )}
        </div>
        <AverageConsumptionChart />
        
        <ConsumptionHistoryModal 
            open={isHistoryOpen}
            onOpenChange={setIsHistoryOpen}
            history={reports}
            loading={isLoading}
            deleteReport={deleteReport}
        />
        
        <ConsumptionImportModal 
            open={isImportOpen}
            onOpenChange={setIsImportOpen}
            kiosks={kiosks}
            addReport={addReport}
        />
    </div>
  )
}
