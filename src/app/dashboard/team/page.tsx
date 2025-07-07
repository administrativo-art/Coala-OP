
"use client"

import { useState } from 'react';
import { ScheduleCalendar } from '@/components/schedule-calendar';
import { EditScheduleModal } from '@/components/edit-schedule-modal';
import { type DailySchedule } from '@/types';

export default function TeamManagement() {
    const [dayToEdit, setDayToEdit] = useState<DailySchedule | null>(null);

    return (
        <>
            <ScheduleCalendar onEditDay={setDayToEdit} />
            <EditScheduleModal 
                dayData={dayToEdit}
                onOpenChange={(open) => !open && setDayToEdit(null)}
            />
        </>
    );
}
