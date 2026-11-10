import type { OnboardingDocument } from '@/types';
import { buildAccountantDependentAnalysis } from '@/features/hr/accountant/dependent-analysis';
import type { AdmissionDependentTemplateConditions } from './admission-signature-order';

type Row = { name: string; birthDate: string; cpf: string };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function monthlySalary(process: Record<string, unknown>): number | null {
  const workflow = record(process.accountantWorkflow);
  const value = process.monthlySalary ?? record(workflow.formData).monthlySalary;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function admissionDependentConditions(process: Record<string, unknown>) {
  const answers = record(process.publicFormAnswers);
  const children = Array.isArray(answers.children) ? answers.children.map(record) : [];
  const documents = Array.isArray(process.documents) ? process.documents as OnboardingDocument[] : [];
  const admissionDate = text(process.expectedAdmissionDate).slice(0, 10);
  const year = Number(admissionDate.slice(0, 4));
  const relationship = text(process.employmentRelationshipType);
  const familyBenefitRelationship = relationship === 'clt' || relationship === 'apprenticeship';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(admissionDate)
    ? new Date(`${admissionDate}T12:00:00Z`) : null;
  const analysis = familyBenefitRelationship && year === 2026 && date && !Number.isNaN(date.getTime())
    ? buildAccountantDependentAnalysis({ answers, documents, monthlySalary: monthlySalary(process), today: date })
    : null;
  const familyRows: Row[] = (analysis?.dependents ?? []).flatMap((item, index) =>
    item.eligibility === 'Elegível' ? [{
      name: item.name,
      birthDate: item.birthDate,
      cpf: text(children[index]?.cpf),
    }] : []
  );
  const incomeTaxRows: Row[] = children.flatMap((child) =>
    child.incomeTaxDependent === true && text(child.name) && text(child.birthDate)
      && text(child.cpf).replace(/\D/g, '').length === 11
      ? [{ name: text(child.name), birthDate: text(child.birthDate), cpf: text(child.cpf) }]
      : []
  );
  const conditions: AdmissionDependentTemplateConditions = {
    familySalaryEligible: familyRows.length > 0,
    incomeTaxDeclared: incomeTaxRows.length > 0,
  };
  return { conditions, familyRows, incomeTaxRows, parameterYearSupported: !familyBenefitRelationship || year === 2026 };
}
