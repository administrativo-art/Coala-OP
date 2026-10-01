import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(180);

export const natashaTeamRequestSchema = z.object({
  unitIds: z.array(idSchema).min(1).max(5),
}).strict().superRefine((input, context) => {
  if (new Set(input.unitIds).size !== input.unitIds.length) {
    context.addIssue({ code: 'custom', path: ['unitIds'], message: 'Unidade repetida.' });
  }
});

const unitSchema = z.object({
  id: idSchema,
  externalId: idSchema.optional(),
}).strict();

const userDocumentSchema = z.object({
  id: idSchema,
  username: z.string().trim().min(1).max(180),
  isActive: z.boolean().optional(),
  inactivationType: z.enum(['temporary', 'contract_termination']).optional(),
  unitId: idSchema.optional(),
  unitIds: z.array(idSchema).max(20).optional(),
  assignedKioskIds: z.array(idSchema).max(20).optional(),
  jobRoleId: idSchema.optional(),
  jobFunctionIds: z.array(idSchema).max(20).optional(),
  shiftDefinitionId: idSchema.optional(),
}).passthrough();

export const natashaTeamDirectorySourceSchema = z.object({
  unitIds: z.array(idSchema).min(1).max(5),
  units: z.array(unitSchema).min(1).max(5),
  users: z.array(z.record(z.string(), z.unknown())).max(1000),
  sourceQueries: z.array(z.string().trim().min(1).max(300)).max(20),
}).strict();

export const natashaTeamDirectoryReportSchema = z.object({
  status: z.enum(['ready_for_confirmation', 'incomplete']),
  scope: z.literal('active_people_linked_to_requested_units'),
  unitIds: z.array(idSchema),
  employees: z.array(z.object({
    id: idSchema,
    name: z.string().trim().min(1).max(180),
    active: z.literal(true),
    allowedUnitIds: z.array(idSchema).min(1).max(5),
    roleIds: z.array(idSchema).max(21),
    shiftDefinitionId: idSchema.nullable(),
  }).strict()).max(50),
  issues: z.array(z.object({
    code: z.enum(['MALFORMED_USER', 'USER_WITHOUT_REQUESTED_UNIT', 'NO_ACTIVE_EMPLOYEES', 'TEAM_LIMIT_REACHED']),
    employeeId: idSchema.optional(),
  }).strict()),
  evidence: z.object({
    sourceQueries: z.array(z.string()),
    returnedDocuments: z.number().int().min(0),
    inactiveDocuments: z.number().int().min(0),
    duplicatesRemoved: z.number().int().min(0),
    requiresHumanConfirmation: z.literal(true),
  }).strict(),
}).strict();

export type NatashaTeamDirectoryReport = z.infer<typeof natashaTeamDirectoryReportSchema>;

/** Normaliza apenas campos de escala; confirmação de equipe e vínculos continua humana. */
export function prepareNatashaTeamDirectory(
  raw: z.input<typeof natashaTeamDirectorySourceSchema>,
): NatashaTeamDirectoryReport {
  const source = natashaTeamDirectorySourceSchema.parse(raw);
  natashaTeamRequestSchema.parse({ unitIds: source.unitIds });
  const expected = new Set(source.unitIds);
  const externalToUnit = new Map(source.units.flatMap((unit) => unit.externalId ? [[unit.externalId, unit.id] as const] : []));
  const issues: NatashaTeamDirectoryReport['issues'] = [];
  const uniqueDocuments = new Map<string, z.infer<typeof userDocumentSchema>>();
  let inactiveDocuments = 0;
  let duplicateDocuments = 0;

  for (const rawUser of source.users) {
    const parsed = userDocumentSchema.safeParse(rawUser);
    if (!parsed.success) {
      const employeeId = typeof rawUser.id === 'string' && rawUser.id.trim() ? rawUser.id.trim() : undefined;
      issues.push({ code: 'MALFORMED_USER', ...(employeeId ? { employeeId } : {}) });
      continue;
    }
    const user = parsed.data;
    if (uniqueDocuments.has(user.id)) {
      duplicateDocuments += 1;
      continue;
    }
    uniqueDocuments.set(user.id, user);
    if (user.isActive === false || user.inactivationType === 'contract_termination') inactiveDocuments += 1;
  }

  const employees = [...uniqueDocuments.values()].flatMap((user) => {
    if (user.isActive === false || user.inactivationType === 'contract_termination') return [];
    const linked = new Set([
      ...(user.unitIds ?? []),
      ...(user.unitId ? [user.unitId] : []),
      ...(user.assignedKioskIds ?? []).flatMap((value) => externalToUnit.get(value) ?? (expected.has(value) ? value : [])),
    ]);
    const allowedUnitIds = source.unitIds.filter((unitId) => linked.has(unitId));
    if (allowedUnitIds.length === 0) {
      issues.push({ code: 'USER_WITHOUT_REQUESTED_UNIT', employeeId: user.id });
      return [];
    }
    const roleIds = [...new Set([
      ...(user.jobRoleId ? [user.jobRoleId] : []),
      ...(user.jobFunctionIds ?? []),
    ])].sort();
    return [{
      id: user.id,
      name: user.username,
      active: true as const,
      allowedUnitIds,
      roleIds,
      shiftDefinitionId: user.shiftDefinitionId ?? null,
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id));

  if (employees.length === 0) issues.push({ code: 'NO_ACTIVE_EMPLOYEES' });
  if (employees.length > 50) issues.push({ code: 'TEAM_LIMIT_REACHED' });
  const report = {
    status: issues.length === 0 && employees.length <= 50 ? 'ready_for_confirmation' as const : 'incomplete' as const,
    scope: 'active_people_linked_to_requested_units' as const,
    unitIds: source.unitIds,
    employees: employees.slice(0, 50),
    issues,
    evidence: {
      sourceQueries: source.sourceQueries,
      returnedDocuments: source.users.length,
      inactiveDocuments,
      duplicatesRemoved: duplicateDocuments,
      requiresHumanConfirmation: true as const,
    },
  };
  return natashaTeamDirectoryReportSchema.parse(report);
}
