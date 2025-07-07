"use client"

import { useState } from 'react';
import { ScheduleCalendar } from '@/components/schedule-calendar';
import { EditScheduleModal } from '@/components/edit-schedule-modal';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';
import { useMonthlySchedule } from '@/hooks/use-monthly-schedule';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { generateSchedule, type GenerateScheduleInput } from '@/ai/flows/generate-schedule-flow';
import { type DailySchedule } from '@/types';

export default function TeamManagement() {
    const { schedule, currentMonth, currentYear, createFullMonthSchedule } = useMonthlySchedule();
    const { kiosks } = useKiosks();
    const { users } = useAuth();
    const { toast } = useToast();

    const [dayToEdit, setDayToEdit] = useState<DailySchedule | null>(null);
    const [reorgData, setReorgData] = useState<DailySchedule | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleSaveSuccess = (savedDay: DailySchedule) => {
        setReorgData(savedDay);
    };

    const handleReorganizeConfirm = async () => {
        if (!reorgData) return;
        setIsGenerating(true);
        toast({ title: "Reorganizando escala...", description: "A IA está reajustando os dias futuros. Isso pode levar um minuto."});

        try {
            const reorgDayIndex = schedule.findIndex(d => d.id === reorgData.id);
            if (reorgDayIndex === -1) {
                throw new Error("Não foi possível encontrar o dia editado na escala atual.");
            }

            const partialScheduleForAI = schedule
                .slice(0, reorgDayIndex + 1)
                .map(day => {
                    const shifts: { kioskName: string; turn: string; employeeUsername: string | undefined }[] = [];
                    Object.keys(day).forEach(key => {
                        const parts = key.split(' ');
                        if (parts.length < 2) return;
                        
                        const turn = parts[parts.length - 1];
                        if (turn === 'T1' || turn === 'T2') {
                            const kioskName = parts.slice(0, -1).join(' ');
                            if (day[key]) {
                                shifts.push({
                                    kioskName,
                                    turn,
                                    employeeUsername: day[key],
                                });
                            }
                        }
                    });
                    return { date: day.id, shifts };
                });
            
            const kiosksToStaff = kiosks.filter(k => k.id !== 'matriz');
            const usersToSchedule = users.filter(u => u.operacional).map(u => ({ id: u.id, username: u.username, turno: u.turno, folguista: u.folguista }));

            const result = await generateSchedule({
                month: currentMonth,
                year: currentYear,
                users: usersToSchedule,
                kiosks: kiosksToStaff,
                partialSchedule: partialScheduleForAI
            });
            
            await createFullMonthSchedule(result);
            toast({ title: "Sucesso!", description: "A escala foi reorganizada com sucesso."});

        } catch (error) {
            console.error("Failed to reorganize schedule:", error);
            toast({ variant: "destructive", title: "Erro ao reorganizar", description: "Não foi possível reorganizar a escala."});
        } finally {
            setReorgData(null);
            setIsGenerating(false);
        }
    };


    return (
        <>
            <ScheduleCalendar onEditDay={setDayToEdit} />
            <EditScheduleModal 
                dayData={dayToEdit}
                onOpenChange={(open) => !open && setDayToEdit(null)}
                onSaveSuccess={handleSaveSuccess}
            />
            {reorgData && (
                <DeleteConfirmationDialog 
                    open={!!reorgData}
                    onOpenChange={() => setReorgData(null)}
                    onConfirm={handleReorganizeConfirm}
                    title="Reorganizar Escala?"
                    description="Deseja que a IA reorganize o restante do mês com base na sua alteração?"
                    confirmButtonText="Sim, reorganizar"
                    isDeleting={isGenerating}
                />
            )}
        </>
    );
}
