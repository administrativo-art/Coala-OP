import 'server-only';

import type { DocumentSnapshot, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { loadNatashaTeam } from '@/features/dp/natasha-team/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import {
  natashaJourneyCandidateSchema,
  prepareNatashaJourneyDirectory,
  type NatashaJourneyDirectoryReport,
} from '@/lib/natasha-journey-directory';
import { AppError } from '@/lib/observability';

const JOURNEY_LIMIT = 100;
const JOURNEY_FIELDS = [
  'lineageId', 'version', 'status', 'name', 'weeklyMinutes', 'cycleLengthDays', 'days',
  'regime', 'weeklyRest', 'scaleValidation', 'allowedShiftDefinitionIds', 'applicability',
  'expectedBreakMinutes', 'useDefinedShiftWhenShorter', 'validFrom', 'validTo',
] as const;

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function texts(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())))]
    : [];
}

function journeyData(document: QueryDocumentSnapshot) {
  return { id: document.id, ...document.data() };
}

function personData(params: {
  document: DocumentSnapshot;
  allowedUnitIds: string[];
  units: Map<string, DocumentSnapshot>;
  groups: Map<string, DocumentSnapshot>;
}) {
  const { document, allowedUnitIds, units, groups } = params;
  if (!document.exists) return null;
  const explicitUnitId = text(document.get('unitId'));
  const unitId = explicitUnitId ?? (allowedUnitIds.length === 1 ? allowedUnitIds[0] : undefined);
  const unit = unitId ? units.get(unitId) : undefined;
  const unitGroupId = text(unit?.get('groupId'));
  const group = unitGroupId ? groups.get(unitGroupId) : undefined;
  const unitOrganizationId = text(unit?.get('organizationId')) ?? text(group?.get('organizationId'));
  const unitGroupIds = [...new Set(allowedUnitIds.map((id) => text(units.get(id)?.get('groupId')))
    .filter((id): id is string => Boolean(id)))];
  const unitOrganizationIds = [...new Set(allowedUnitIds.map((id) => {
    const allowedUnit = units.get(id);
    const allowedGroupId = text(allowedUnit?.get('groupId'));
    return text(allowedUnit?.get('organizationId'))
      ?? (allowedGroupId ? text(groups.get(allowedGroupId)?.get('organizationId')) : undefined);
  }).filter((id): id is string => Boolean(id)))];
  return {
    id: document.id,
    name: text(document.get('username')) ?? document.id,
    ...(text(document.get('jobRoleId')) ? { jobRoleId: text(document.get('jobRoleId')) } : {}),
    jobFunctionIds: texts(document.get('jobFunctionIds')),
    ...(unitId ? { unitId } : {}),
    unitIds: allowedUnitIds,
    ...(unitGroupId ? { unitGroupId } : {}),
    unitGroupIds,
    ...(unitOrganizationId ? { unitOrganizationId } : {}),
    unitOrganizationIds,
  };
}

/** Lê a fonte oficial e resolve a jornada por colaborador/data antes de qualquer proposta. */
export async function loadNatashaJourneyDirectory(params: {
  context: ServerUserContext;
  period: string;
  unitIds: string[];
  employeeIds: string[];
}): Promise<NatashaJourneyDirectoryReport> {
  const { context, period, unitIds, employeeIds } = params;
  const fullTeam = await loadNatashaTeam({ context, unitIds });
  const requested = new Set(employeeIds);
  const employees = fullTeam.employees.filter((employee) => requested.has(employee.id));
  const missingIds = employeeIds.filter((employeeId) => !employees.some((employee) => employee.id === employeeId));
  if (missingIds.length > 0) {
    throw new AppError({
      code: 'NATASHA_JOURNEY_EMPLOYEE_OUTSIDE_TEAM',
      kind: 'EXPECTED_BUSINESS',
      safeMessage: 'Um colaborador informado não pertence à equipe candidata das unidades solicitadas.',
      metadata: { missingCount: missingIds.length },
    });
  }
  const team = { ...fullTeam, employees };

  const userDocuments = await dbAdmin.getAll(...employeeIds.map((id) => dbAdmin.collection('users').doc(id)));
  const allowedUnitsByEmployee = new Map(employees.map((employee) => [employee.id, employee.allowedUnitIds]));
  const personUnitIds = [...new Set(userDocuments.flatMap((document) => {
    const explicit = text(document.get('unitId'));
    const allowed = allowedUnitsByEmployee.get(document.id) ?? [];
    return [...allowed, ...(explicit ? [explicit] : [])];
  }))];
  const unitDocuments = personUnitIds.length
    ? await dbAdmin.getAll(...personUnitIds.map((id) => dbAdmin.collection('dp_units').doc(id)))
    : [];
  const units = new Map(unitDocuments.filter((document) => document.exists).map((document) => [document.id, document]));
  const groupIds = [...new Set(unitDocuments.map((document) => text(document.get('groupId'))).filter((id): id is string => Boolean(id)))];
  const groupDocuments = groupIds.length
    ? await dbAdmin.getAll(...groupIds.map((id) => dbAdmin.collection('dp_unitGroups').doc(id)))
    : [];
  const groups = new Map(groupDocuments.filter((document) => document.exists).map((document) => [document.id, document]));
  const people = userDocuments.flatMap((document) => {
    const person = personData({
      document,
      allowedUnitIds: allowedUnitsByEmployee.get(document.id) ?? [],
      units,
      groups,
    });
    return person ? [person] : [];
  });

  const journeySnapshot = await dbAdmin.collection('dp_journeys')
    .where('status', 'in', ['published', 'archived'])
    .select(...JOURNEY_FIELDS)
    .limit(JOURNEY_LIMIT + 1)
    .get();
  if (journeySnapshot.size > JOURNEY_LIMIT) {
    throw new AppError({
      code: 'NATASHA_JOURNEY_CATALOG_LIMIT_REACHED',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'Há jornadas demais para resolver a equipe com segurança.',
      metadata: { queryLimit: JOURNEY_LIMIT },
    });
  }

  return prepareNatashaJourneyDirectory({
    period,
    unitIds,
    team,
    people,
    journeys: journeySnapshot.docs.map((document) => natashaJourneyCandidateSchema.parse(journeyData(document))),
    sourceQueries: [
      ...fullTeam.evidence.sourceQueries,
      `users:getAll:${employeeIds.length}`,
      `dp_units:getAll:${personUnitIds.length}`,
      `dp_unitGroups:getAll:${groupIds.length}`,
      'dp_journeys:status:published|archived',
    ],
  });
}

export const NATASHA_JOURNEY_QUERY_LIMITS = {
  maxUnits: 5,
  maxEmployees: 50,
  maxJourneyDocuments: JOURNEY_LIMIT,
} as const;
