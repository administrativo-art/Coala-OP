import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { isAsoAppointmentAfterAdmission } from '@/features/hr/aso/dates';
import { clinicLocationLabel, readClinicLocation } from '@/features/hr/aso/clinic-location';
import { resolveAsoClinicLocation } from '@/features/hr/aso/clinic-location.server';
import { hashAsoToken } from '@/features/hr/aso/workflow';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(value: unknown, max = 1000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function findProcess(token: string) {
  const result = await hrDbAdmin.collection('onboardingProcesses').where('asoClinicTokenHash', '==', hashAsoToken(token)).limit(1).get();
  return result.empty ? null : result.docs[0];
}

function expired(value: unknown) {
  const expiresAt = text(value, 40);
  return !expiresAt || new Date(expiresAt).getTime() <= Date.now();
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params; const snapshot = await findProcess(token);
  if (!snapshot) return NextResponse.json({ error: 'Link inválido.' }, { status: 404 });
  const process = snapshot.data();
  if (expired(process.asoClinicTokenExpiresAt)) return NextResponse.json({ error: 'Este link expirou. Entre em contato com o RH.' }, { status: 410 });
  const workflow = record(process.asoWorkflow); const appointment = record(workflow.appointment);
  return NextResponse.json({
    candidateName: text(process.candidateName, 240),
    expectedAdmissionDate: text(process.expectedAdmissionDate, 10) || null,
    alreadyResponded: Boolean(text(appointment.proposedAt, 40)),
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params; const snapshot = await findProcess(token);
  if (!snapshot) return NextResponse.json({ error: 'Link inválido.' }, { status: 404 });
  const process = snapshot.data();
  if (expired(process.asoClinicTokenExpiresAt)) return NextResponse.json({ error: 'Este link expirou.' }, { status: 410 });
  const body = await request.json().catch(() => ({})); const date = text(body.date, 10); const time = text(body.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Informe a data e o horário.' }, { status: 400 });
  const now = new Date().toISOString(); const workflow = record(process.asoWorkflow); const currentAppointment = record(workflow.appointment);
  if (text(currentAppointment.source, 40) === 'clinic_form' && text(currentAppointment.proposedAt, 40)) return NextResponse.json({ error: 'Este agendamento já foi informado.' }, { status: 409 });
  const clinic = record(workflow.clinic); const requestValidation = record(workflow.requestValidation);
  const clinicEntityId = text(workflow.clinicEntityId, 180) || text(requestValidation.clinicEntityId, 180);
  const clinicLocation = readClinicLocation(clinic.location)
    || readClinicLocation(requestValidation.clinicLocation)
    || await resolveAsoClinicLocation(clinicEntityId, text(clinic.name, 240));
  const location = clinicLocationLabel(clinicLocation);
  if (!clinicLocation || !location) return NextResponse.json({ error: 'O endereço da clínica não está configurado. Entre em contato com o RH.' }, { status: 409 });
  await Promise.all([
    snapshot.ref.set({ asoWorkflow: { ...workflow, status: 'appointment_pending_review', appointmentStatus: 'awaiting_clinic', appointment: { date, time, location, instructions: null, source: 'clinic_form', responseText: null, confidence: 1, proposedAt: now }, clinic: { ...clinic, location: clinicLocation, repliedAt: now }, updatedAt: now }, updatedAt: now }, { merge: true }),
    snapshot.ref.collection('asoEvents').doc(randomUUID()).set({ type: 'CLINIC_SCHEDULE_SUBMITTED', at: now, actorId: null, actorEmail: null, source: 'clinic_form', date, time }),
  ]);
  return NextResponse.json({
    ok: true,
    appointmentAfterAdmission: isAsoAppointmentAfterAdmission(date, text(process.expectedAdmissionDate, 10) || null),
  });
}
