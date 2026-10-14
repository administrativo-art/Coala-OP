"use client";

import { auth } from '@/lib/firebase';
import { authenticatedApiRequest } from '@/lib/authenticated-api-client';
import type { DPSchedule, DPShift } from '@/types';
import type { DPJourneyValidationResult } from '@/features/dp/journey-validation/core';

const SHIFT_CHANGE_EVENT = 'coala:dp-schedule-shifts-changed';

export function notifyDPScheduleShiftsChanged(scheduleId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHIFT_CHANGE_EVENT, { detail: { scheduleId } }));
}

export function subscribeToDPScheduleShiftChanges(scheduleIds: string[], listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const expectedIds = new Set(scheduleIds);
  const handleChange = (event: Event) => {
    const scheduleId = (event as CustomEvent<{ scheduleId?: string }>).detail?.scheduleId;
    if (scheduleId && expectedIds.has(scheduleId)) listener();
  };
  window.addEventListener(SHIFT_CHANGE_EVENT, handleChange);
  return () => window.removeEventListener(SHIFT_CHANGE_EVENT, handleChange);
}

export function fetchSchedule(scheduleId: string) {
  return authenticatedApiRequest<{ schedule: DPSchedule }>(
    `/api/dp/schedules/${encodeURIComponent(scheduleId)}`,
    { getIdToken: async () => auth.currentUser?.getIdToken() ?? null },
  ).then((payload) => payload.schedule);
}

export function fetchScheduleShifts(scheduleId: string) {
  return authenticatedApiRequest<{ shifts: DPShift[] }>(
    `/api/dp/schedules/${encodeURIComponent(scheduleId)}/shifts`,
    { getIdToken: async () => auth.currentUser?.getIdToken() ?? null },
  ).then((payload) => payload.shifts);
}

export function fetchScheduleJourneyValidation(scheduleId: string) {
  return authenticatedApiRequest<{ validation: DPJourneyValidationResult }>(
    `/api/dp/schedules/${encodeURIComponent(scheduleId)}/journey-validation`,
    { getIdToken: async () => auth.currentUser?.getIdToken() ?? null },
  ).then((payload) => payload.validation);
}
