'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRhCache, useEmployeeProfile } from '../hooks/useEmployeeProfile';
import { ProfileCompletion } from './ProfileCompletion';
import { SectionCard } from './SectionCard';
import { SectionEditModal } from './SectionEditModal';
import { getStatusBadge } from '../lib/field-format';
import { ImageVoiceConsentCard } from './ImageVoiceConsentCard';
import { EmployeeProbationCard } from './EmployeeProbationCard';
import { canEditField, canViewField } from '@/types/rh';
import type { FieldMapEntry, EmployeeFieldValue, FieldVisibilityContext, RhRole } from '@/types/rh';

const SECTION_LABELS: Record<string, string> = {
  identity:  'Dados pessoais',
  contact:   'Contato',
  address:   'Endereço',
  emergency: 'Contato de emergência',
  banking:   'Dados bancários',
};

const EMPLOYEE_VISIBLE_SECTIONS = Object.keys(SECTION_LABELS);

function cleanIds(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className}`} />;
}

export function MyProfilePage() {
  const { cache, loading: cacheLoading } = useRhCache();
  const [editKey, setEditKey]            = useState<string | null>(null);

  const bizneoId = cache?.bizneo_employee_id ?? '';
  const profileState = useEmployeeProfile(bizneoId);

  if (cacheLoading || profileState.status === 'loading' || profileState.status === 'idle') {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!cache?.bizneo_employee_id) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-gray-700">Seu perfil ainda não foi vinculado.</p>
          <p className="text-xs text-gray-400 mt-1">
            Fale com o administrador para associar seu usuário ao cadastro do Bizneo.
          </p>
        </div>
      </div>
    );
  }

  if (profileState.status === 'error') {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-red-600">{profileState.message}</p>
      </div>
    );
  }

  const {
    employee,
    fieldValues,
    fieldMap,
    consentimento_imagem_voz,
    ciencia_privacidade_onboarding,
    periodo_experiencia,
  } = profileState.data;
  const { label: statusLabel, color: statusColor } = getStatusBadge(employee.status);
  const initials = employee.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const ownerRole: RhRole = 'employee';
  const visibilityContext: FieldVisibilityContext = {
    isOwner: true,
    userId: cache.auth_uid ?? employee.auth_uid ?? null,
    roleIds: cleanIds([
      cache.job_role_id,
      ...(cache.job_role_ids ?? []),
      ...(cache.role_ids ?? []),
    ]),
    functionIds: cleanIds([
      cache.job_function_id,
      ...(cache.job_function_ids ?? []),
      ...(cache.function_ids ?? []),
    ]),
  };

  const sections = Object.entries(fieldMap.fields).reduce<
    Record<string, Array<{ key: string; entry: FieldMapEntry; fv?: EmployeeFieldValue; editable?: boolean }>>
  >((acc, [key, entry]) => {
    if (!canViewField(entry.visibility, ownerRole, visibilityContext, entry.access, fieldMap.access_matrix)) return acc;
    if (!EMPLOYEE_VISIBLE_SECTIONS.includes(entry.section)) return acc;
    if (!acc[entry.section]) acc[entry.section] = [];
    acc[entry.section].push({
      key,
      entry,
      fv: fieldValues[key],
      editable: canEditField(entry, ownerRole, visibilityContext, fieldMap.access_matrix),
    });
    return acc;
  }, {});

  const allFields = EMPLOYEE_VISIBLE_SECTIONS.flatMap((s) => sections[s] ?? []);

  return (
    <div className="max-w-2xl space-y-4">
      {/* Header card */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            {employee.photo_url ? (
              <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-white shadow">
                <Image src={employee.photo_url} alt={employee.name} width={64} height={64} className="object-cover w-full h-full" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center ring-2 ring-white shadow">
                <span className="text-white text-lg font-semibold">{initials}</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 truncate">{employee.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5 truncate">{employee.email}</p>
            <span className={`text-xs font-medium mt-1.5 inline-block px-2 py-0.5 rounded-full ${statusColor}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Completion */}
      <ProfileCompletion
        pct={employee.profile_completion}
        fieldMap={fieldMap}
        fieldValues={fieldValues}
      />

      <ImageVoiceConsentCard
        employeeId={employee.bizneo_employee_id}
        initialConsent={consentimento_imagem_voz}
        privacyAcknowledgement={ciencia_privacidade_onboarding}
        canRevoke
      />

      <EmployeeProbationCard probation={periodo_experiencia} />

      {/* Editable sections */}
      {EMPLOYEE_VISIBLE_SECTIONS.filter((s) => sections[s]?.length).map((sec) => (
        <SectionCard
          key={sec}
          title={SECTION_LABELS[sec] ?? sec}
          fields={sections[sec]}
          role={ownerRole}
          onEdit={setEditKey}
        />
      ))}

      {/* Edit modal */}
      {editKey && (
        <SectionEditModal
          employeeId={employee.bizneo_employee_id}
          editKey={editKey}
          fields={allFields}
          role="employee"
          onClose={() => setEditKey(null)}
          onSaved={() => setEditKey(null)}
        />
      )}
    </div>
  );
}
