/** @jsxImportSource react-pdf-react-server */
import React from 'react-pdf-react-server';
import { Document, Image, Page, StyleSheet, Text, View } from 'react-pdf-renderer-server';

export type AccountantDependentAnalysis = {
  name: string;
  birthDate: string;
  ageLabel: string;
  documentDetails: string;
  eligibility: string;
};

export type AccountantAdmissionFormData = {
  companyName: string;
  employerCnpj: string;
  employeeName: string;
  maritalStatus: string;
  employeeCpf: string;
  educationLevel: string;
  admissionDate: string;
  jobFunction: string;
  salaryLabel: string;
  probationContract: string;
  weeklyRest: string;
  workSchedule: string;
  salaryLimitLabel: string;
  quotaLabel: string;
  familySalaryConclusion: string;
  dependents: AccountantDependentAnalysis[];
  logoDataUri?: string | null;
};

const BLUE = '#3E6078';
const BORDER = '#C9D4DD';
const MUTED = '#6B7F91';

const styles = StyleSheet.create({
  page: { padding: 34, fontFamily: 'Helvetica', color: '#24384B', fontSize: 8.5 },
  logo: { width: 76, height: 48, objectFit: 'contain', alignSelf: 'center' },
  title: { marginTop: 4, textAlign: 'center', fontFamily: 'Helvetica-Bold', fontSize: 18, color: BLUE },
  subtitle: { marginTop: 3, textAlign: 'center', fontSize: 9, color: MUTED },
  divider: { height: 1.5, marginTop: 14, marginBottom: 10, backgroundColor: BLUE },
  section: { marginBottom: 10 },
  sectionTitle: { paddingVertical: 5, paddingHorizontal: 8, backgroundColor: BLUE, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 9.5 },
  row: { flexDirection: 'row', borderLeftWidth: 0.8, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: BORDER },
  cell: { padding: 7, minHeight: 40 },
  borderRight: { borderRightWidth: 0.8, borderRightColor: BORDER },
  label: { color: MUTED, fontFamily: 'Helvetica-Bold', fontSize: 6.5, textTransform: 'uppercase' },
  value: { marginTop: 3, fontSize: 9.5 },
  analysisHeader: { padding: 8, borderLeftWidth: 0.8, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: BORDER, backgroundColor: '#EAF7F0' },
  analysisConclusion: { color: '#166534', fontFamily: 'Helvetica-Bold', fontSize: 10 },
  analysisMeta: { marginTop: 3, color: '#3F5E50', fontSize: 7.5 },
  dependentRow: { flexDirection: 'row', borderLeftWidth: 0.8, borderRightWidth: 0.8, borderBottomWidth: 0.8, borderColor: BORDER },
  dependentCell: { padding: 5, minHeight: 28, justifyContent: 'center' },
  dependentName: { width: '23%' },
  dependentBirth: { width: '14%' },
  dependentAge: { width: '10%' },
  dependentDocs: { width: '35%' },
  dependentEligibility: { width: '18%' },
  tableHeader: { backgroundColor: '#F2F5F7', color: MUTED, fontFamily: 'Helvetica-Bold', fontSize: 6.5, textTransform: 'uppercase' },
  note: { marginTop: 6, color: MUTED, fontSize: 7, lineHeight: 1.3 },
  footer: { position: 'absolute', left: 34, right: 34, bottom: 18, textAlign: 'center', color: '#8A99A7', fontSize: 6.5 },
});

function Cell({ label, value, width, right = true }: { label: string; value: string; width: string; right?: boolean }) {
  return <View style={[styles.cell, { width }, right ? styles.borderRight : {}]}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value || 'Não informado'}</Text></View>;
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return <View style={styles.section} wrap={false}><Text style={styles.sectionTitle}>{number}. {title}</Text>{children}</View>;
}

export function AccountantAdmissionFormPdf({ data }: { data: AccountantAdmissionFormData }) {
  return <Document title={`Formulário de admissão - ${data.employeeName}`} author="Coala Shakes">
    <Page size="A4" style={styles.page}>
      {data.logoDataUri ? <Image src={data.logoDataUri} style={styles.logo} /> : null}
      <Text style={styles.title}>FORMULÁRIO DE ADMISSÃO</Text>
      <Text style={styles.subtitle}>Informações para registro contábil e trabalhista</Text>
      <View style={styles.divider} />

      <Section number={1} title="DADOS DA EMPRESA">
        <View style={styles.row}><Cell label="Razão social" value={data.companyName} width="68%" /><Cell label="CNPJ" value={data.employerCnpj} width="32%" right={false} /></View>
      </Section>

      <Section number={2} title="DADOS DO COLABORADOR">
        <View style={styles.row}><Cell label="Nome completo" value={data.employeeName} width="68%" /><Cell label="Estado civil" value={data.maritalStatus} width="32%" right={false} /></View>
        <View style={styles.row}><Cell label="CPF" value={data.employeeCpf} width="34%" /><Cell label="Grau de instrução" value={data.educationLevel} width="38%" /><Cell label="Dependentes informados" value={String(data.dependents.length)} width="28%" right={false} /></View>
      </Section>

      <Section number={3} title="DADOS DO CONTRATO">
        <View style={styles.row}><Cell label="Data de admissão" value={data.admissionDate} width="30%" /><Cell label="Cargo / função" value={data.jobFunction} width="42%" /><Cell label="Salário" value={data.salaryLabel} width="28%" right={false} /></View>
        <View style={styles.row}><Cell label="Contrato de experiência" value={data.probationContract} width="50%" /><Cell label="Folga semanal" value={data.weeklyRest} width="50%" right={false} /></View>
      </Section>

      <Section number={4} title="JORNADA DE TRABALHO">
        <View style={styles.row}><Cell label="Jornada informada" value={data.workSchedule} width="100%" right={false} /></View>
      </Section>

      <Section number={5} title="ANÁLISE DE SALÁRIO-FAMÍLIA">
        <View style={styles.analysisHeader}>
          <Text style={styles.analysisConclusion}>{data.familySalaryConclusion}</Text>
          <Text style={styles.analysisMeta}>Limite mensal considerado: {data.salaryLimitLabel}  •  Cota por dependente elegível: {data.quotaLabel}</Text>
        </View>
        {data.dependents.length ? <>
          <View style={styles.dependentRow}>
            <Text style={[styles.dependentCell, styles.dependentName, styles.borderRight, styles.tableHeader]}>Dependente</Text>
            <Text style={[styles.dependentCell, styles.dependentBirth, styles.borderRight, styles.tableHeader]}>Nascimento</Text>
            <Text style={[styles.dependentCell, styles.dependentAge, styles.borderRight, styles.tableHeader]}>Idade</Text>
            <Text style={[styles.dependentCell, styles.dependentDocs, styles.borderRight, styles.tableHeader]}>Documentação</Text>
            <Text style={[styles.dependentCell, styles.dependentEligibility, styles.tableHeader]}>Resultado</Text>
          </View>
          {data.dependents.map((dependent, index) => <View key={`${dependent.name}-${index}`} style={styles.dependentRow}>
            <Text style={[styles.dependentCell, styles.dependentName, styles.borderRight]}>{dependent.name}</Text>
            <Text style={[styles.dependentCell, styles.dependentBirth, styles.borderRight]}>{dependent.birthDate}</Text>
            <Text style={[styles.dependentCell, styles.dependentAge, styles.borderRight]}>{dependent.ageLabel}</Text>
            <Text style={[styles.dependentCell, styles.dependentDocs, styles.borderRight]}>{dependent.documentDetails}</Text>
            <Text style={[styles.dependentCell, styles.dependentEligibility]}>{dependent.eligibility}</Text>
          </View>)}
        </> : <View style={styles.row}><Cell label="Dependentes" value="Nenhum dependente informado" width="100%" right={false} /></View>}
        <Text style={styles.note}>Parâmetros de 2026 conforme a Portaria Interministerial MPS/MF nº 13, de 9 de janeiro de 2026. A conclusão considera a remuneração informada, a idade e os documentos aprovados na integração. A contabilidade deve observar a legislação vigente na competência do registro.</Text>
      </Section>

      <Text style={styles.footer}>Documento gerado pelo Coala Shakes • versão auditável preservada no processo de admissão</Text>
    </Page>
  </Document>;
}
