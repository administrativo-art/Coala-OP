
      "use client"

import { useState } from "react"
import { useKiosks from "@/hooks/use-kiosks"
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"

import { Button } from "@/components/ui/button"
import { UploadCloud, History, Scale } from 'lucide-react'
import { ConsumptionHistoryModal } from "./consumption-history-modal";
import { ConsumptionImportModal } from "./consumption-import-modal";
import { ConsumptionComparisonModal } from "./consumption-comparison-modal"
import { AverageConsumptionChart } from "./average-consumption-chart"


export function ConsumptionAnalysisDashboard() {
  const { kiosks } = useKiosks();
  const { reports: consumptionHistory, baseProducts, isLoading, addReport, deleteReport } = useValidatedConsumptionData();

  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);

  return (
    <>
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-2 justify-end">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsHistoryModalOpen(true)}>
                    <History className="mr-2 h-4 w-4" /> Histórico
                </Button>
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsComparisonModalOpen(true)}>
                    <Scale className="mr-2 h-4 w-4" /> Analisar variação
                </Button>
                <Button onClick={() => setIsImportModalOpen(true)} className="w-full sm:w-auto">
                    <UploadCloud className="mr-2" />
                    Importar relatório
                </Button>
            </div>
            
            <AverageConsumptionChart />
        </div>

        <ConsumptionHistoryModal
            open={isHistoryModalOpen}
            onOpenChange={setIsHistoryModalOpen}
            history={consumptionHistory}
            loading={isLoading}
            deleteReport={deleteReport}
        />
        
        <ConsumptionImportModal
            open={isImportModalOpen}
            onOpenChange={setIsImportModalOpen}
            kiosks={kiosks}
            baseProducts={baseProducts}
            addReport={addReport}
        />

        <ConsumptionComparisonModal
            open={isComparisonModalOpen}
            onOpenChange={setIsComparisonModalOpen}
            history={consumptionHistory}
            products={baseProducts}
            kiosks={kiosks}
        />
    </>
  )
}

    