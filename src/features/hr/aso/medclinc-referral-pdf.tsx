import React from 'react';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

export type MedclincReferralPdfData = {
  companyName: string;
  employerCnpj: string;
  employeeName: string;
  employeeCpf: string;
  jobFunction: string;
  serviceDate?: string | null;
  observations?: string | null;
  logoDataUri?: string | null;
  letterheadLogoDataUri?: string | null;
  examType?: 'admission' | 'dismissal';
};

const BLUE = '#1F6FB2';
const BORDER = '#111111';
const MUTED = '#5C7182';

const styles = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingHorizontal: 54,
    paddingBottom: 20,
    fontFamily: 'Times-Roman',
    fontSize: 8.4,
    color: '#111111',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 63 },
  logo: { width: 150, height: 56, objectFit: 'contain' },
  clinic: { width: 330, textAlign: 'right', color: MUTED, fontFamily: 'Times-Bold', fontSize: 8.5, lineHeight: 1.18 },
  title: { marginTop: 13, textAlign: 'center', color: BLUE, fontFamily: 'Times-Bold', fontSize: 16 },
  subtitle: { marginTop: 3, marginBottom: 5, textAlign: 'center', color: MUTED, fontFamily: 'Times-Bold', fontSize: 10.5 },
  section: { marginTop: 7 },
  sectionLabel: {
    alignSelf: 'flex-start',
    paddingTop: 2.5,
    paddingBottom: 2.2,
    paddingHorizontal: 6,
    backgroundColor: BLUE,
    color: '#FFFFFF',
    fontFamily: 'Times-Bold',
    fontSize: 10,
    borderTopWidth: 0.8,
    borderLeftWidth: 0.8,
    borderRightWidth: 0.8,
    borderColor: BORDER,
  },
  box: { borderWidth: 0.8, borderColor: BORDER },
  row: { flexDirection: 'row' },
  cell: { paddingVertical: 3, paddingHorizontal: 6, minHeight: 29 },
  rightBorder: { borderRightWidth: 0.8, borderRightColor: BORDER },
  bottomBorder: { borderBottomWidth: 0.8, borderBottomColor: BORDER },
  fieldLabel: { color: MUTED, fontFamily: 'Times-Bold', fontSize: 6.5, textTransform: 'uppercase' },
  fieldValue: { marginTop: 1.2, fontSize: 9.5, lineHeight: 1.05 },
  company: { width: '36%' },
  cnpj: { width: '32%' },
  payment: { width: '32%' },
  employeeName: { width: '46%' },
  employeeCpf: { width: '34%' },
  sector: { width: '20%' },
  jobFunction: { width: '46%' },
  serviceDate: { width: '54%' },
  observations: { width: '100%', minHeight: 31 },
  examTypeColumn: { width: '50%', paddingVertical: 4, paddingHorizontal: 7 },
  option: { marginBottom: 2.2, fontSize: 9.2, lineHeight: 1.03 },
  checked: { color: BLUE, fontFamily: 'Times-Bold' },
  pcmso: { paddingVertical: 3, paddingHorizontal: 7 },
  pcmsoTitle: { fontSize: 9.4, lineHeight: 1.05 },
  pcmsoHelper: { marginTop: 1.5, color: MUTED, fontFamily: 'Times-Italic', fontSize: 7.2 },
  examColumn: { width: '50%', minHeight: 125, paddingVertical: 4, paddingHorizontal: 7 },
  examItem: { marginBottom: 2.1, fontSize: 8.8, lineHeight: 1.02 },
  referralLeft: { width: '50%', paddingVertical: 4, paddingHorizontal: 7 },
  referralRight: { width: '50%', paddingVertical: 4, paddingHorizontal: 7 },
  instructionBox: { paddingVertical: 4, paddingHorizontal: 7, minHeight: 49 },
  instruction: { fontSize: 7.7, lineHeight: 1.12 },
  authorization: { marginTop: 5, fontFamily: 'Times-Bold', fontSize: 9.3 },
  letterheadLogo: {
    position: 'absolute',
    right: 14,
    bottom: 7,
    width: 48,
    height: 48,
    objectFit: 'contain',
  },
});

const leftExams = [
  'HEMOGRAMA',
  'GLICEMIA EM JEJUM',
  'TIPAGEM SANGUÍNEA',
  'VDRL',
  'EAS - URINA',
  'EPF - FEZES',
  'TRIGLICERÍDEOS',
  'CREATININA',
  'GAMA GT',
  'MICOLÓGICO DE UNHA',
  'LIPIDOGRAMA',
  'OUTROS: ____________________',
] as const;

const rightExams = [
  'EXAME TOXICOLÓGICO',
  'AVALIAÇÃO PSICOSSOCIAL',
  'EXAME CLÍNICO - ASO',
  'AUDIOMETRIA',
  'ECG - ELETROCARDIOGRAMA',
  'EEG - ELETROENCEFALOGRAMA',
  'ESPIROMETRIA',
  'ACUIDADE VISUAL',
  'RX DO TÓRAX P.A.',
  'RAIO X DA COLUNA',
  'OUTROS: ____________________',
] as const;

function Field({ label, value, style, allowBlank = false }: { label: string; value: string; style: React.ComponentProps<typeof View>['style']; allowBlank?: boolean }) {
  const fieldStyles = Array.isArray(style) ? style : style ? [style] : [];
  return (
    <View style={[styles.cell, ...fieldStyles]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value || (allowBlank ? ' ' : 'Não informado')}</Text>
    </View>
  );
}

function Section({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionLabel}>{number}. {title}</Text>
      {children}
    </View>
  );
}

function Option({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <Text style={styles.option}>
      <Text style={checked ? styles.checked : undefined}>( {checked ? 'X' : '   '} )</Text> {label}
    </Text>
  );
}

export function MedclincReferralPdf({ data }: { data: MedclincReferralPdfData }) {
  return (
    <Document title={`Guia ASO ${data.examType === 'dismissal' ? 'demissional' : 'admissional'} - ${data.employeeName}`} author="Coala One">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          {data.logoDataUri ? <Image src={data.logoDataUri} style={styles.logo} /> : <View style={styles.logo} />}
          <View style={styles.clinic}>
            <Text>Avenida Gomes de Castro, nº 178, Centro</Text>
            <Text>Em frente ao Ginásio Costa Rodrigues, na lateral da escola Liceu Maranhense</Text>
            <Text>(98) 3256-2737  •  (98) 98409-7916</Text>
          </View>
        </View>

        <Text style={styles.title}>GUIA DE ENCAMINHAMENTO</Text>
        <Text style={styles.subtitle}>Autorização de Exames</Text>

        <Section number={1} title="DADOS DA EMPRESA">
          <View style={[styles.box, styles.row]}>
            <Field label="Empresa" value={data.companyName} style={[styles.company, styles.rightBorder]} />
            <Field label="CNPJ" value={data.employerCnpj} style={[styles.cnpj, styles.rightBorder]} />
            <Field label="Forma de pagamento" value="PIX" style={styles.payment} />
          </View>
        </Section>

        <Section number={2} title="DADOS DO COLABORADOR">
          <View style={styles.box}>
            <View style={[styles.row, styles.bottomBorder]}>
              <Field label="Nome" value={data.employeeName} style={[styles.employeeName, styles.rightBorder]} />
              <Field label="CPF" value={data.employeeCpf} style={[styles.employeeCpf, styles.rightBorder]} />
              <Field label="Setor" value="GERAL" style={styles.sector} />
            </View>
            <View style={[styles.row, styles.bottomBorder]}>
              <Field label="Função" value={data.jobFunction} style={[styles.jobFunction, styles.rightBorder]} />
              <Field label="Data do atendimento" value={data.serviceDate || 'A DEFINIR PELA CLÍNICA'} style={styles.serviceDate} />
            </View>
            <Field label="Observações" value={data.observations || ''} style={styles.observations} allowBlank />
          </View>
        </Section>

        <Section number={3} title="TIPO DE EXAME">
          <View style={[styles.box, styles.row]}>
            <View style={[styles.examTypeColumn, styles.rightBorder]}>
              <Option label="ADMISSIONAL" checked={data.examType !== 'dismissal'} />
              <Option label="PERIÓDICO ANUAL" />
              <Option label="PERIÓDICO SEMESTRAL" />
              <Option label="DEMISSIONAL" checked={data.examType === 'dismissal'} />
            </View>
            <View style={styles.examTypeColumn}>
              <Option label="RETORNO AO TRABALHO" />
              <Option label="MUDANÇA DE FUNÇÃO" />
              <Option label="OUTROS: ______________________" />
            </View>
          </View>
        </Section>

        <Section number={4} title="EXAMES">
          <View style={styles.box}>
            <View style={[styles.pcmso, styles.bottomBorder]}>
              <Text style={styles.pcmsoTitle}><Text style={styles.checked}>( X )</Text> EXAMES CONFORME O PCMSO - PROGRAMA DE CONTROLE MÉDICO DE SAÚDE OCUPACIONAL</Text>
              <Text style={styles.pcmsoHelper}>Não há necessidade da marcação abaixo, caso a empresa (cliente) já tenha o PCMSO disponibilizado à MEDCLINIC.</Text>
            </View>
            <View style={styles.row}>
              <View style={[styles.examColumn, styles.rightBorder]}>
                {leftExams.map(exam => <Text key={exam} style={styles.examItem}>(    ) {exam}</Text>)}
              </View>
              <View style={styles.examColumn}>
                {rightExams.map(exam => <Text key={exam} style={styles.examItem}>(    ) {exam}</Text>)}
              </View>
            </View>
          </View>
        </Section>

        <Section number={5} title="ENCAMINHADO PARA">
          <View style={[styles.box, styles.row]}>
            <View style={[styles.referralLeft, styles.rightBorder]}>
              <Option label="CONSULTA OFTALMOLOGISTA" />
              <Option label="CONSULTA ORTOPEDISTA" />
              <Option label="CONSULTA CARDIOLOGISTA" />
              <Option label="OUTROS: ____________________" />
            </View>
            <View style={styles.referralRight}>
              <Text style={styles.option}><Text style={{ fontFamily: 'Times-Bold' }}>SEGUE RAC:</Text>  (    ) SIM   (    ) NÃO</Text>
              <Text style={styles.option}>QUAIS: _____________________________</Text>
              <Text style={styles.option}>___________________________________</Text>
            </View>
          </View>
        </Section>

        <Section number={6} title="INSTRUÇÕES E AUTORIZAÇÃO">
          <View style={[styles.box, styles.instructionBox]}>
            <Text style={styles.instruction}>Todos os EXAMES LABORATORIAIS deverão ser realizados EM JEJUM DE 12 HORAS (somente ingestão de água), com EXCEÇÃO de Tipagem Sanguínea, VHS, Hemograma e Beta HCG. Para realização de exames laboratoriais, chegar de 07h00 às 10h00, de segunda a sexta. Atendimento por ordem de chegada.</Text>
            <Text style={styles.authorization}>AUTORIZADO POR: _________________________________________________</Text>
          </View>
        </Section>

        {data.letterheadLogoDataUri ? <Image src={data.letterheadLogoDataUri} style={styles.letterheadLogo} fixed /> : null}
      </Page>
    </Document>
  );
}
