import { createHash } from 'node:crypto';

import { z } from 'zod';

import { natashaCoveragePlanSchema, type NatashaCoveragePlan } from './natasha-roster-coverage';
import { natashaProposalInputsSchema, type NatashaProposalInputs } from './natasha-proposal-preflight';
import { generateNatashaAlternatives, natashaSolverOptionsSchema, type NatashaSolverOptions } from './natasha-roster-solver';
import { natashaRosterSnapshotSchema, type NatashaRosterSnapshot } from './natasha-roster-validator';

const idSchema = z.string().trim().min(1).max(180);
const slotSchema = z.enum(['opening', 'closing', 'intermediate', 'single']);

const assignmentSchema = z.object({
  positionId: idSchema,
  employeeId: idSchema,
  unitId: idSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  slot: slotSchema,
}).strict();

const alternativeSchema = z.object({
  id: idSchema,
  label: z.string().regex(/^[A-Z]$/),
  rank: z.number().int().min(1).max(5),
  score: z.number().int().min(0),
  metrics: z.object({
    openingAfterClosing: z.number().int().min(0),
    shiftSpread: z.number().int().min(0),
    sundaySpread: z.number().int().min(0),
    saraMix: z.number().int().min(0),
  }).strict(),
  differenceFromBest: z.number().int().min(0).max(500),
  changedPositionIds: z.array(idSchema).max(500),
  assignments: z.array(assignmentSchema).max(500),
  review: z.object({
    status: z.literal('pending'),
    note: z.null(),
  }).strict(),
}).strict();

const confirmationSchema = z.object({
  team: z.boolean(),
  rolesAndUnitLinks: z.boolean(),
  shiftPositions: z.boolean(),
  vacations: z.boolean(),
  unavailabilities: z.boolean(),
  fixedAssignments: z.boolean(),
  nextMonthCommitments: z.boolean(),
}).strict();

export const natashaProposalPackageSchema = z.object({
  schemaVersion: z.literal('natasha-proposal/v1'),
  packageId: idSchema,
  proposalVersion: z.string().regex(/^v1-[a-f0-9]{16}$/),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  status: z.enum(['ready_for_review', 'not_ready', 'infeasible', 'search_limit']),
  source: z.object({
    hashAlgorithm: z.literal('sha256'),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/),
    expectedUnitIds: z.array(idSchema).max(5),
    historyComplete: z.boolean(),
    coverageScopeConfirmed: z.boolean(),
    employeeCount: z.number().int().min(0).max(50),
    positionCount: z.number().int().min(0).max(500),
    confirmed: confirmationSchema,
  }).strict(),
  solver: z.object({
    status: z.enum(['not_ready', 'alternatives', 'infeasible', 'search_limit']),
    preflight: z.object({
      period: z.string(),
      status: z.enum(['ready_for_solver', 'questions_pending', 'infeasible']),
      scope: z.literal('input_readiness_only'),
      positions: z.number().int().min(0),
      activeEmployees: z.number().int().min(0),
      issues: z.array(z.object({
        code: z.string(),
        category: z.enum(['question', 'data', 'feasibility']),
        detail: z.string(),
        date: z.string().optional(),
        unitId: z.string().optional(),
        positionId: z.string().optional(),
        employeeId: z.string().optional(),
      }).strict()),
    }).strict(),
    search: z.object({
      nodesVisited: z.number().int().min(0),
      feasibleSolutionsSeen: z.number().int().min(0),
      limitReached: z.boolean(),
      exhaustive: z.boolean(),
      maxNodes: z.number().int().min(1),
      minDifferentAssignments: z.number().int().min(1),
    }).strict(),
    weights: z.object({
      openingAfterClosing: z.number().int().min(0),
      shiftSpread: z.number().int().min(0),
      sundaySpread: z.number().int().min(0),
      saraMix: z.number().int().min(0),
    }).strict(),
    caveat: z.string().min(1),
  }).strict(),
  review: z.object({
    status: z.literal('pending'),
    selectedAlternativeId: z.null(),
    note: z.null(),
  }).strict(),
  alternatives: z.array(alternativeSchema).max(5),
}).strict();

export type NatashaProposalPackage = z.infer<typeof natashaProposalPackageSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

/**
 * Empacota uma busca local em uma revisão humana reproduzível. O pacote não
 * persiste decisão nem altera escala; a versão muda quando fonte ou opções mudam.
 */
export function buildNatashaProposalPackage(
  snapshotInput: NatashaRosterSnapshot,
  coveragePlanInput: NatashaCoveragePlan,
  inputsInput: NatashaProposalInputs,
  rawOptions: NatashaSolverOptions = {},
): NatashaProposalPackage {
  const snapshot = natashaRosterSnapshotSchema.parse(snapshotInput);
  const coveragePlan = natashaCoveragePlanSchema.parse(coveragePlanInput);
  const inputs = natashaProposalInputsSchema.parse(inputsInput);
  const options = natashaSolverOptionsSchema.parse(rawOptions);
  const report = generateNatashaAlternatives(snapshot, coveragePlan, inputs, options);
  const inputHash = digest({ snapshot, coveragePlan, inputs, options });
  const proposalVersion = `v1-${inputHash.slice(0, 16)}`;
  const packageId = `natasha:${inputs.period}:${proposalVersion}`;
  const best = report.alternatives[0]?.assignments ?? [];
  const bestByPosition = new Map(best.map((assignment) => [assignment.positionId, assignment.employeeId]));
  const alternatives = report.alternatives.map((alternative, index) => {
    const changedPositionIds = alternative.assignments
      .filter((assignment) => bestByPosition.get(assignment.positionId) !== assignment.employeeId)
      .map((assignment) => assignment.positionId)
      .sort();
    const id = `alternative:${digest({ inputHash, assignments: alternative.assignments }).slice(0, 16)}`;
    return {
      id,
      label: alternative.label,
      rank: index + 1,
      score: alternative.score,
      metrics: alternative.metrics,
      differenceFromBest: alternative.differenceFromBest,
      changedPositionIds,
      assignments: alternative.assignments,
      review: { status: 'pending' as const, note: null },
    };
  });
  const status = report.status === 'alternatives' ? 'ready_for_review' : report.status;
  return natashaProposalPackageSchema.parse({
    schemaVersion: 'natasha-proposal/v1',
    packageId,
    proposalVersion,
    period: inputs.period,
    status,
    source: {
      hashAlgorithm: 'sha256',
      inputHash,
      expectedUnitIds: coveragePlan.expectedUnitIds,
      historyComplete: snapshot.history?.complete ?? false,
      coverageScopeConfirmed: coveragePlan.scopeConfirmed,
      employeeCount: inputs.employees.length,
      positionCount: inputs.positions.length,
      confirmed: inputs.confirmed,
    },
    solver: {
      status: report.status,
      preflight: report.preflight,
      search: report.search,
      weights: report.weights,
      caveat: report.caveat,
    },
    review: { status: 'pending', selectedAlternativeId: null, note: null },
    alternatives,
  });
}
