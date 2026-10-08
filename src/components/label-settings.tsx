
"use client";

import { useState } from 'react';

import QRCode from 'qrcode';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { CancelButton, LotModalShell, ShellEyebrow, ShellFacts } from './stock/lot-modal-shell';
import { labelSizes, type LabelSize } from '@/lib/label-sizes';

interface LabelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LabelSettingsModal({ isOpen, onClose }: LabelSettingsModalProps) {
    const { labelSizeId, updateLabelSize, loading } = useCompanySettings();
    const { toast } = useToast();

    const handleSizeChange = async (sizeId: string) => {
        await updateLabelSize(sizeId);
        toast({ title: 'Tamanho da etiqueta atualizado.' });
    };

    const handlePrintSample = async () => {
        toast({ title: "Impressão de etiquetas em atualização." });
    };

    const current = labelSizes.find((size: LabelSize) => size.id === labelSizeId);

    return (
        <LotModalShell
            open={isOpen}
            onOpenChange={(open) => { if (!open) onClose(); }}
            title="Configurações de etiqueta"
            description="Personalize a aparência das etiquetas de lote. A alteração é salva para toda a empresa."
            width={820}
            sidebarWidth={280}
            sidebar={
                <>
                    <ShellEyebrow>Etiquetas</ShellEyebrow>
                    <h2 className="m-0 text-xl font-extrabold leading-[1.2] tracking-[-.02em]">Etiqueta de lote</h2>
                    <span className="text-[12.5px] leading-normal text-[#a3a2ad]">A alteração é salva para toda a empresa e vale para todas as impressões de etiqueta.</span>
                    <ShellFacts
                        rows={[
                            { label: 'Modelo', value: current ? current.name : '—' },
                            { label: 'Tamanho', value: current ? `${current.width} × ${current.height} mm` : '—' },
                        ]}
                    />
                </>
            }
            footer={
                <>
                    <CancelButton onClick={onClose}>Fechar</CancelButton>
                    <button type="button" onClick={handlePrintSample} disabled={loading} className="h-11 whitespace-nowrap rounded-xl border border-[#dcd9d1] bg-white px-4 text-[13.5px] font-bold hover:bg-[#f6f4ef] disabled:opacity-50">
                        Ver exemplo
                    </button>
                </>
            }
        >
            <div className="flex flex-col gap-1">
                <h3 className="m-0 text-[21px] font-extrabold tracking-[-.02em]">Tamanho da etiqueta</h3>
                <span className="text-[13px] text-[#70757d]">Selecione o modelo de etiqueta que você usa na impressão.</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {labelSizes.map((size: LabelSize) => {
                    const on = labelSizeId === size.id;
                    return (
                        <button
                            key={size.id}
                            type="button"
                            disabled={loading}
                            onClick={() => handleSizeChange(size.id)}
                            className={cn(
                                'flex flex-col items-start gap-[3px] rounded-[14px] px-3.5 py-3 text-left disabled:opacity-60',
                                on ? 'border-2 border-[#5b5bd6] bg-[#eeeefc]' : 'border border-[#dcd9d1] bg-white hover:bg-[#f6f4ef]',
                            )}
                        >
                            <span className="text-[13.5px] font-bold">{size.name}</span>
                            <span className="text-xs text-[#70757d]">{size.width}mm × {size.height}mm</span>
                        </button>
                    );
                })}
            </div>
        </LotModalShell>
    );
}
