'use client';

import { useRef, useState, useEffect } from 'react';
import { useEmployeeProfile } from '../hooks/useEmployeeProfile';
import { useAuditLog } from '../hooks/useAuditLog';
import { EmployeeHeader } from './EmployeeHeader';
import { ProfileCompletion } from './ProfileCompletion';
import { SectionCard } from './SectionCard';
import { AuditLogTab } from './AuditLogTab';
import { SectionEditModal } from './SectionEditModal';
import { canEditField } from '@/types/rh';
import type { FieldMapEntry, EmployeeFieldValue, FieldVisibilityContext, RhRole } from '@/types/rh';

const SECTION_LABELS: Record<string, string> = {
  identity:     'Identidade',
  contact:      'Contato',
  address:      'Endereço',
  documents:    'Documentos',
  employment:   'Emprego',
  compensation: 'Remuneração',
  banking:      'Bancário',
  health:       'Saúde',
  emergency:    'Emergência',
  uniforms:     'Uniformes',
  onboarding:   'Onboarding',
  diversity:    'Diversidade',
};

type Tab = 'perfil' | 'historico' | 'contratos' | 'remuneracoes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'perfil',       label: 'Perfil' },
  { id: 'historico',    label: 'Histórico' },
  { id: 'contratos',    label: 'Contratos' },
  { id: 'remuneracoes', label: 'Remunerações' },
];

type Props = { bizneoEmployeeId: string };

function isLegacyUniformField(key: string, entry: FieldMapEntry) {
  return key.startsWith('employee.uniform_') || entry.section.toLowerCase() === 'uniforme';
}

function cleanIds(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className}`} />;
}

export function ProfilePage({ bizneoEmployeeId }: Props) {
  const profileState  = useEmployeeProfile(bizneoEmployeeId);
  const [tab, setTab] = useState<Tab>('perfil');
  const [activeSection, setActiveSection]   = useState<string>('');
  const [editKey, setEditKey]               = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const auditState = useAuditLog(bizneoEmployeeId);

  // Scroll spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) {
          const topmost = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          );
          setActiveSection((topmost.target as HTMLElement).dataset.section ?? '');
        }
      },
      { threshold: 0.25, rootMargin: '-80px 0px -60% 0px' }
    );

    const refs = sectionRefs.current;
    Object.values(refs).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [profileState]);

  if (profileState.status === 'loading' || profileState.status === 'idle') {
    return (
      <div className="flex gap-3">
        <div className="hidden lg:block w-52 shrink-0 space-y-2 pt-1">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </div>
        <div className="flex-1 space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="hidden xl:block w-64 shrink-0">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (profileState.status === 'error') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-sm font-medium text-red-600">{profileState.message}</p>
          <p className="text-xs text-gray-400 mt-1">Verifique suas permissões ou tente novamente.</p>
        </div>
      </div>
    );
  }

  const { employee, fieldValues, fieldMap, cache } = profileState.data;
  const role = cache.rh_role as RhRole;
  const visibilityContext: FieldVisibilityContext = {
    isOwner: cache.bizneo_employee_id === bizneoEmployeeId || employee.auth_uid === cache.auth_uid,
    canViewConfidential: role === 'admin',
    userId: cache.auth_uid ?? null,
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

  // Group fields by section
  const visibleProfileFields = Object.entries(fieldMap.fields).filter(
    ([key, entry]) => !isLegacyUniformField(key, entry),
  );

  const sections = visibleProfileFields.reduce<
    Record<string, Array<{ key: string; entry: FieldMapEntry; fv?: EmployeeFieldValue; editable?: boolean }>>
  >((acc, [key, entry]) => {
    const sec = entry.section;
    if (!acc[sec]) acc[sec] = [];
    acc[sec].push({
      key,
      entry,
      fv: fieldValues[key],
      editable: role !== 'employee' && canEditField(entry, role, visibilityContext, fieldMap.access_matrix),
    });
    return acc;
  }, {});

  const sectionOrder = Object.keys(SECTION_LABELS);
  const orderedSections = [
    ...sectionOrder.filter((s) => sections[s]),
    ...Object.keys(sections).filter((s) => !sectionOrder.includes(s)),
  ];

  const scrollTo = (sec: string) => {
    sectionRefs.current[sec]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex min-h-0 gap-2">
      {/* Scroll-spy sidebar */}
      {tab === 'perfil' && (
        <nav className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-36 shrink-0 flex-col gap-0.5 self-start overflow-y-auto pt-1 lg:flex">
          {orderedSections.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => scrollTo(sec)}
              className={`truncate rounded-md px-2 py-1 text-left text-[11px] transition-colors ${
                activeSection === sec
                  ? 'bg-violet-50 text-violet-700 font-medium'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              {SECTION_LABELS[sec] ?? sec}
            </button>
          ))}
        </nav>
      )}

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-2.5">
        <EmployeeHeader employee={employee} cache={cache} />

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-100 pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'text-violet-700'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-4 -bottom-px h-0.5 rounded-full bg-violet-600" />
              )}
            </button>
          ))}
        </div>

        {/* Tab: Perfil */}
        {tab === 'perfil' && (
          <div className="space-y-3">
            {orderedSections.map((sec) => (
              <div
                key={sec}
                data-section={sec}
                ref={(el) => { sectionRefs.current[sec] = el; }}
              >
                <SectionCard
                  title={SECTION_LABELS[sec] ?? sec}
                  fields={sections[sec] ?? []}
                  role={role}
                  onEdit={role !== 'employee' ? setEditKey : undefined}
                />
              </div>
            ))}
          </div>
        )}

        {/* Tab: Histórico */}
        {tab === 'historico' && (
          <AuditLogTab
            entries={auditState.status === 'ok' ? auditState.entries : []}
            fieldMap={fieldMap}
            loading={auditState.status === 'loading' || auditState.status === 'idle'}
          />
        )}

        {/* Tab: Contratos */}
        {tab === 'contratos' && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <p className="text-sm">Contratos — em breve.</p>
          </div>
        )}

        {/* Tab: Remunerações */}
        {tab === 'remuneracoes' && (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <p className="text-sm">Histórico salarial — em breve.</p>
          </div>
        )}
      </div>

      {/* Right panel — completion */}
      <div className="sticky top-24 hidden w-52 shrink-0 self-start xl:block">
        <ProfileCompletion
          pct={employee.profile_completion}
          fieldMap={fieldMap}
          fieldValues={fieldValues}
        />
      </div>

      {/* Edit modal */}
      {editKey && (
        <SectionEditModal
          employeeId={employee.bizneo_employee_id}
          editKey={editKey}
          fields={orderedSections.flatMap((s) => sections[s] ?? [])}
          role={role}
          onClose={() => setEditKey(null)}
          onSaved={(_key, _value, _completion) => setEditKey(null)}
        />
      )}
    </div>
  );
}
