"use client"

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { ScheduleCalendar } from '@/components/schedule-calendar';
import { EditScheduleModal } from '@/components/edit-schedule-modal';
import { type DailySchedule } from '@/types';

export default function TeamManagement() {
    const { users } = useAuth();
    const [dayToEdit, setDayToEdit] = useState<DailySchedule | null>(null);
    const [kioskToEdit, setKioskToEdit] = useState<string | null>(null);

    const handleEdit = (day: DailySchedule, kioskId: string) => {
        setDayToEdit(day);
        setKioskToEdit(kioskId);
    };

    const handleCloseModal = (open: boolean) => {
        if (!open) {
            setDayToEdit(null);
            setKioskToEdit(null);
        }
    };

    return (
        <>
            <ScheduleCalendar onEditDay={handleEdit} />
            <EditScheduleModal 
                dayData={dayToEdit}
                kioskId={kioskToEdit}
                onOpenChange={handleCloseModal}
                users={users}
            />
        </>
    );
}
