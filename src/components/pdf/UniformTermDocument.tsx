/** @jsxImportSource react-pdf-react-server */
import React from "react-pdf-react-server";
import { Document, Image, Page, StyleSheet, Text, View } from "react-pdf-renderer-server";

import type { LotEntry, UniformAssignment, UniformReturnedCondition } from "@/types";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
    padding: 40,
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    marginBottom: 6,
    textAlign: "center",
    textTransform: "uppercase",
  },
  subtitle: {
    color: "#4B5563",
    fontSize: 9,
    marginBottom: 24,
    textAlign: "center",
  },
  section: {
    borderColor: "#E5E7EB",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    padding: 12,
  },
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 5,
  },
  label: {
    color: "#6B7280",
    width: 130,
  },
  value: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
  },
  paragraph: {
    marginBottom: 8,
    textAlign: "justify",
  },
  signatureArea: {
    bottom: 54,
    left: 40,
    position: "absolute",
    right: 40,
  },
  signatureRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureBox: {
    width: "45%",
  },
  signatureLine: {
    borderTopColor: "#111827",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    marginBottom: 5,
    paddingTop: 5,
    textAlign: "center",
  },
  signatureHint: {
    color: "#6B7280",
    fontSize: 8,
    textAlign: "center",
  },
  footer: {
    bottom: 24,
    color: "#9CA3AF",
    fontSize: 8,
    left: 40,
    position: "absolute",
    right: 40,
    textAlign: "center",
  },
  brandRow: {
    alignItems: "center",
    borderBottomColor: "#E5E7EB",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 22,
    paddingBottom: 12,
  },
  brandLogo: {
    height: 38,
    objectFit: "contain",
    width: 115,
  },
  protocol: {
    color: "#6B7280",
    fontSize: 8,
    textAlign: "right",
  },
  itemHeader: {
    backgroundColor: "#F8FAFC",
    borderRadius: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginBottom: 7,
    padding: 7,
  },
  signatureImage: {
    height: 42,
    marginBottom: 3,
    objectFit: "contain",
    width: "100%",
  },
  signedLabel: {
    color: "#047857",
    fontSize: 7,
    marginTop: 2,
    textAlign: "center",
  },
  compactPage: {
    fontSize: 9,
    lineHeight: 1.35,
    paddingTop: 28,
  },
  compactBrandRow: {
    marginBottom: 10,
    paddingBottom: 7,
  },
  compactBrandLogo: {
    height: 28,
  },
  compactTitle: {
    fontSize: 14,
    marginBottom: 2,
  },
  compactSubtitle: {
    fontSize: 8,
    marginBottom: 10,
  },
  compactSection: {
    marginBottom: 7,
    padding: 8,
  },
  compactSectionTitle: {
    fontSize: 10,
    marginBottom: 4,
  },
  compactRow: {
    marginBottom: 2,
  },
  compactItemHeader: {
    marginBottom: 3,
    padding: 4,
  },
  compactParagraph: {
    marginBottom: 4,
  },
  compactSignatureImage: {
    height: 34,
  },
  letterheadBackground: {
    height: 841.89,
    left: 0,
    position: "absolute",
    top: 0,
    width: 595.28,
  },
  letterheadBrandRow: {
    borderBottomWidth: 0,
    justifyContent: "flex-end",
    marginBottom: 14,
  },
  letterheadFooter: {
    bottom: 16,
    right: 150,
    textAlign: "left",
  },
  previewNoticeTop: {
    color: "#6D28D9",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    left: 36,
    position: "absolute",
    right: 36,
    textAlign: "center",
    top: 15,
  },
  previewNoticeBottom: {
    bottom: 15,
    color: "#6D28D9",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    left: 36,
    position: "absolute",
    right: 36,
    textAlign: "center",
  },
  previewWatermark: {
    color: "#D1D5DB",
    fontFamily: "Helvetica-Bold",
    fontSize: 27,
    left: 55,
    opacity: 0.22,
    position: "absolute",
    right: 55,
    textAlign: "center",
    top: 400,
    transform: "rotate(32deg)",
  },
});

const modernStyles = StyleSheet.create({
  page: {
    color: "#0F172A",
    fontFamily: "Helvetica",
    fontSize: 8,
    lineHeight: 1.35,
    paddingBottom: 58,
    paddingHorizontal: 36,
    paddingTop: 34,
  },
  meta: {
    alignItems: "flex-end",
    marginBottom: 8,
  },
  pagePill: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    color: "#64748B",
    fontFamily: "Helvetica-Bold",
    fontSize: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  movementPill: {
    backgroundColor: "#FCE7F3",
    borderRadius: 12,
    color: "#EC4899",
    fontFamily: "Helvetica-Bold",
    fontSize: 6,
    letterSpacing: 1,
    marginTop: 7,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  headingBlock: {
    marginBottom: 14,
  },
  heading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    letterSpacing: -0.5,
    lineHeight: 1.15,
  },
  headingSubtitle: {
    color: "#64748B",
    fontSize: 7.5,
    lineHeight: 1.4,
    marginTop: 5,
  },
  section: {
    marginBottom: 12,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: 7,
  },
  sectionDot: {
    borderRadius: 2,
    height: 5,
    marginRight: 7,
    width: 5,
  },
  sectionHeadingText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  sectionSummary: {
    color: "#94A3B8",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
    marginLeft: "auto",
  },
  identityGrid: {
    borderColor: "#E2E8F0",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  identityRow: {
    flexDirection: "row",
  },
  identityRowBorder: {
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: 1,
  },
  identityCell: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    width: "50%",
  },
  identityCellBorder: {
    borderRightColor: "#E2E8F0",
    borderRightWidth: 1,
  },
  fieldLabel: {
    color: "#94A3B8",
    fontFamily: "Helvetica-Bold",
    fontSize: 6,
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  fieldValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    marginTop: 3,
  },
  table: {
    borderColor: "#E2E8F0",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  tableHeader: {
    backgroundColor: "#F8FAFC",
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  tableHeaderText: {
    color: "#94A3B8",
    fontFamily: "Helvetica-Bold",
    fontSize: 5.5,
    textTransform: "uppercase",
  },
  tableRow: {
    alignItems: "center",
    borderTopColor: "#E2E8F0",
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  tableText: {
    color: "#334155",
    fontSize: 6.5,
    paddingRight: 4,
  },
  tableTextStrong: {
    color: "#0F172A",
    fontFamily: "Helvetica-Bold",
  },
  conditionPill: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 10,
    flexDirection: "row",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  conditionDot: {
    borderRadius: 2,
    height: 3,
    marginRight: 3,
    width: 3,
  },
  conditionPillText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 5.5,
  },
  conditionNew: {
    backgroundColor: "#DCFCE7",
    color: "#15803D",
  },
  conditionUsed: {
    backgroundColor: "#FEF3C7",
    color: "#B45309",
  },
  conditionDamaged: {
    backgroundColor: "#FEE2E2",
    color: "#DC2626",
  },
  exchangeColumns: {
    flexDirection: "row",
    gap: 12,
  },
  exchangeColumn: {
    width: "50%",
  },
  exchangeCard: {
    borderColor: "#E2E8F0",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  exchangeItem: {
    flexDirection: "row",
    paddingVertical: 8,
  },
  exchangeItemBorder: {
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: 1,
  },
  exchangeItemContent: {
    flex: 1,
    paddingRight: 5,
  },
  exchangeItemName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
  },
  exchangeItemDetails: {
    color: "#64748B",
    fontSize: 5.8,
    marginTop: 2,
  },
  exchangeItemDestination: {
    color: "#334155",
    fontFamily: "Helvetica-Bold",
    fontSize: 5.8,
    marginTop: 2,
  },
  declarationBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 9,
    color: "#334155",
    fontSize: 7.3,
    lineHeight: 1.55,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  notes: {
    color: "#64748B",
    fontSize: 6.5,
    marginTop: 5,
  },
  signatures: {
    bottom: 150,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 36,
    position: "absolute",
    right: 36,
  },
  signature: {
    width: "46%",
  },
  signatureImage: {
    height: 32,
    objectFit: "contain",
    width: "100%",
  },
  signatureLine: {
    borderTopColor: "#0F172A",
    borderTopWidth: 1,
    paddingTop: 5,
  },
  signatureName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
  },
  signatureRole: {
    color: "#94A3B8",
    fontSize: 6.2,
    marginTop: 2,
  },
});

type UniformTermItem = Pick<
  LotEntry,
  "productName" | "apparelType" | "apparelColor" | "apparelSize" | "condition"
>;

type UniformAssignmentTermItem = Pick<
  UniformAssignment,
  "productName" | "apparelType" | "apparelColor" | "apparelSize" | "issuedCondition"
>;

function formatDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function conditionLabel(value?: string) {
  if (value === "novo") return "Novo";
  if (value === "usado") return "Usado";
  if (value === "bom_estado") return "Bom estado";
  if (value === "danificado") return "Danificado";
  if (value === "inutilizavel") return "Inutilizável";
  return value || "-";
}

function details(item: { apparelType?: string | null; apparelColor?: string | null; apparelSize?: string | null }) {
  return [item.apparelType, item.apparelColor, item.apparelSize ? `Tam. ${item.apparelSize}` : null]
    .filter(Boolean)
    .join(" · ") || "-";
}

function Field({ label, value, compact = false }: { label: string; value?: string | number | null; compact?: boolean }) {
  return (
    <View style={compact ? [styles.row, styles.compactRow] : styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value === undefined || value === null || value === "" ? "-" : String(value)}</Text>
    </View>
  );
}

function SignatureBlock({ collaboratorName, registeredByName }: { collaboratorName: string; registeredByName?: string | null }) {
  return (
    <View style={styles.signatureArea}>
      <View style={styles.signatureRow}>
        <View style={styles.signatureBox}>
          <Text style={styles.signatureLine}>{collaboratorName}</Text>
          <Text style={styles.signatureHint}>Assinatura do colaborador</Text>
        </View>
        <View style={styles.signatureBox}>
          <Text style={styles.signatureLine}>{registeredByName || "Responsável/RH"}</Text>
          <Text style={styles.signatureHint}>Assinatura do responsável</Text>
        </View>
      </View>
    </View>
  );
}

export function UniformDeliveryTermDocument({
  collaboratorName,
  registeredByName,
  lot,
  quantity,
  deliveryDate,
  notes,
}: {
  collaboratorName: string;
  registeredByName?: string | null;
  lot: UniformTermItem;
  quantity: number;
  deliveryDate: string;
  notes?: string;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Termo de entrega de uniforme</Text>
        <Text style={styles.subtitle}>Documento para controle interno de entrega de peça ao colaborador.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dados da entrega</Text>
          <Field label="Colaborador" value={collaboratorName} />
          <Field label="Data da entrega" value={formatDate(deliveryDate)} />
          <Field label="Quantidade" value={`${quantity} peça(s)`} />
          <Field label="Responsável" value={registeredByName || "Responsável/RH"} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Peça entregue</Text>
          <Field label="Uniforme" value={lot.productName} />
          <Field label="Classificação" value={details(lot)} />
          <Field label="Condição" value={conditionLabel(lot.condition)} />
          <Field label="Observações" value={notes || "-"} />
        </View>

        <Text style={styles.paragraph}>
          Declaro que recebi a peça descrita neste termo, em quantidade e condição informadas acima, comprometendo-me
          com o uso adequado e com a devolução quando solicitado pela empresa.
        </Text>

        <SignatureBlock collaboratorName={collaboratorName} registeredByName={registeredByName} />
        <Text style={styles.footer}>Documento gerado pelo Coala ERP para controle de uniformes.</Text>
      </Page>
    </Document>
  );
}

export function UniformReturnTermDocument({
  collaboratorName,
  registeredByName,
  assignment,
  quantity,
  returnDate,
  returnedCondition,
  notes,
}: {
  collaboratorName: string;
  registeredByName?: string | null;
  assignment: UniformAssignmentTermItem;
  quantity: number;
  returnDate: string;
  returnedCondition: UniformReturnedCondition;
  notes?: string;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Termo de devolução e avaliação de uniforme</Text>
        <Text style={styles.subtitle}>Documento para registro da avaliação realizada pelo RH no ato da devolução.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dados da devolução</Text>
          <Field label="Colaborador" value={collaboratorName} />
          <Field label="Data da devolução" value={formatDate(returnDate)} />
          <Field label="Quantidade" value={`${quantity} peça(s)`} />
          <Field label="Responsável" value={registeredByName || "Responsável/RH"} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Peça avaliada</Text>
          <Field label="Uniforme" value={assignment.productName} />
          <Field label="Classificação" value={details(assignment)} />
          <Field label="Condição da entrega" value={conditionLabel(assignment.issuedCondition)} />
          <Field label="Condição devolvida" value={conditionLabel(returnedCondition)} />
          <Field label="Ressalvas da avaliação" value={notes || "-"} />
        </View>

        <Text style={styles.paragraph}>
          Declaro ciência da avaliação registrada neste termo no momento da devolução da peça. O destino operacional da
          peça será definido pelo RH após a assinatura deste documento, podendo retornar ao estoque como peça usada ou
          ser descartada conforme a condição apurada.
        </Text>

        <SignatureBlock collaboratorName={collaboratorName} registeredByName={registeredByName} />
        <Text style={styles.footer}>Documento gerado pelo Coala ERP para controle de uniformes.</Text>
      </Page>
    </Document>
  );
}

export type SignedUniformTermItem = {
  productName: string;
  quantity: number;
  condition: string;
  apparelType?: string | null;
  apparelColor?: string | null;
  apparelSize?: string | null;
  stockDisposition?: string | null;
};

function dispositionLabel(value?: string | null) {
  if (value === "retorna_estoque") return "Retornar ao estoque como usado";
  if (value === "descartar") return "Descartar";
  if (value === "reter_avaliacao") return "Reter para avaliação";
  return value || "-";
}

function SignedSignatureBlock({
  collaboratorName,
  registeredByName,
  collaboratorSignature,
  responsibleSignature,
  signedAt,
  compact = false,
}: {
  collaboratorName: string;
  registeredByName: string;
  collaboratorSignature?: string | null;
  responsibleSignature?: string | null;
  signedAt?: string | null;
  compact?: boolean;
}) {
  return (
    <View style={styles.signatureArea}>
      <View style={styles.signatureRow}>
        <View style={styles.signatureBox}>
          {collaboratorSignature
            ? <Image style={compact ? [styles.signatureImage, styles.compactSignatureImage] : styles.signatureImage} src={collaboratorSignature} />
            : <View style={compact ? [styles.signatureImage, styles.compactSignatureImage] : styles.signatureImage} />}
          <Text style={styles.signatureLine}>{collaboratorName}</Text>
          <Text style={styles.signatureHint}>Colaborador</Text>
          {signedAt ? <Text style={styles.signedLabel}>Assinatura coletada em {formatDate(signedAt)}</Text> : null}
        </View>
        <View style={styles.signatureBox}>
          {responsibleSignature
            ? <Image style={compact ? [styles.signatureImage, styles.compactSignatureImage] : styles.signatureImage} src={responsibleSignature} />
            : <View style={compact ? [styles.signatureImage, styles.compactSignatureImage] : styles.signatureImage} />}
          <Text style={styles.signatureLine}>{registeredByName}</Text>
          <Text style={styles.signatureHint}>Responsável pela movimentação</Text>
          {signedAt ? <Text style={styles.signedLabel}>Assinatura coletada em {formatDate(signedAt)}</Text> : null}
        </View>
      </View>
    </View>
  );
}

export function SignedUniformMovementTermDocument({
  type,
  protocol,
  collaboratorName,
  collaboratorDocument,
  registeredByName,
  occurredAt,
  outgoingItems,
  incomingItems,
  notes,
  collaboratorSignature,
  responsibleSignature,
  logoDataUri,
  letterheadDataUri,
  preview = false,
}: {
  type: "delivery" | "exchange" | "return";
  protocol: string;
  collaboratorName: string;
  collaboratorDocument?: string | null;
  registeredByName: string;
  occurredAt: string;
  outgoingItems: SignedUniformTermItem[];
  incomingItems: SignedUniformTermItem[];
  notes?: string | null;
  collaboratorSignature?: string | null;
  responsibleSignature?: string | null;
  signedAt?: string | null;
  logoDataUri?: string | null;
  letterheadDataUri?: string | null;
  preview?: boolean;
}) {
  const title = type === "delivery"
    ? "Termo de entrega"
    : type === "exchange"
      ? "Termo de troca"
      : "Termo de devolução";
  const declaration = type === "delivery"
    ? "Declaro que recebi os itens descritos neste termo, nas quantidades e condições informadas, e que fui orientado(a) quanto ao uso, conservação e devolução quando solicitado pela empresa."
    : type === "exchange"
      ? "Declaro que devolvi e recebi os itens descritos neste termo, concordando com as quantidades, condições e ressalvas registradas no ato da troca."
      : "Declaro que devolvi os itens descritos neste termo e tomei ciência da avaliação de condição e do destino operacional registrado para cada peça.";

  const conditionTone = (condition: string) => {
    if (condition === "novo") {
      return { style: modernStyles.conditionNew, color: "#15803D" };
    }
    if (condition === "danificado" || condition === "inutilizavel") {
      return { style: modernStyles.conditionDamaged, color: "#DC2626" };
    }
    return { style: modernStyles.conditionUsed, color: "#B45309" };
  };
  const ConditionBadge = ({ condition }: { condition: string }) => {
    const tone = conditionTone(condition);
    return (
      <View style={[modernStyles.conditionPill, tone.style]}>
        <View style={[modernStyles.conditionDot, { backgroundColor: tone.color }]} />
        <Text style={[modernStyles.conditionPillText, { color: tone.color }]}>{conditionLabel(condition)}</Text>
      </View>
    );
  };
  const SectionHeading = ({
    color,
    children,
    summary,
  }: {
    color: string;
    children: React.ReactNode;
    summary?: string;
  }) => (
    <View style={modernStyles.sectionHeading}>
      <View style={[modernStyles.sectionDot, { backgroundColor: color }]} />
      <Text style={modernStyles.sectionHeadingText}>{children}</Text>
      {summary ? <Text style={modernStyles.sectionSummary}>{summary}</Text> : null}
    </View>
  );
  const totalSummary = (items: SignedUniformTermItem[]) => {
    const pieces = items.length;
    const units = items.reduce((sum, item) => sum + item.quantity, 0);
    return `${pieces} ${pieces === 1 ? "peça" : "peças"} · ${units} ${units === 1 ? "unidade" : "unidades"}`;
  };
  const itemModel = (item: SignedUniformTermItem) => item.apparelType || "-";
  const shortDisposition = (value?: string | null) => {
    if (value === "retorna_estoque") return "Retornar ao estoque";
    return dispositionLabel(value);
  };
  const Identification = () => (
    <View style={modernStyles.section}>
      <SectionHeading color="#EC4899">Identificação</SectionHeading>
      <View style={modernStyles.identityGrid}>
        <View style={[modernStyles.identityRow, modernStyles.identityRowBorder]}>
          <View style={[modernStyles.identityCell, modernStyles.identityCellBorder]}>
            <Text style={modernStyles.fieldLabel}>Colaborador</Text>
            <Text style={modernStyles.fieldValue}>{collaboratorName}</Text>
          </View>
          <View style={modernStyles.identityCell}>
            <Text style={modernStyles.fieldLabel}>CPF/Documento</Text>
            <Text style={modernStyles.fieldValue}>{collaboratorDocument || "Não informado"}</Text>
          </View>
        </View>
        <View style={modernStyles.identityRow}>
          <View style={[modernStyles.identityCell, modernStyles.identityCellBorder]}>
            <Text style={modernStyles.fieldLabel}>Data da movimentação</Text>
            <Text style={modernStyles.fieldValue}>{formatDate(occurredAt)}</Text>
          </View>
          <View style={modernStyles.identityCell}>
            <Text style={modernStyles.fieldLabel}>Responsável</Text>
            <Text style={modernStyles.fieldValue}>{registeredByName}</Text>
          </View>
        </View>
      </View>
    </View>
  );
  const widths = type === "delivery"
    ? ["27%", "21%", "14%", "12%", "8%", "18%"]
    : ["22%", "16%", "10%", "8%", "7%", "14%", "23%"];
  const TableCell = ({
    width,
    strong,
    children,
  }: {
    width: string;
    strong?: boolean;
    children: React.ReactNode;
  }) => (
    <View style={{ width }}>
      {typeof children === "string" || typeof children === "number"
        ? <Text style={strong ? [modernStyles.tableText, modernStyles.tableTextStrong] : modernStyles.tableText}>{children}</Text>
        : children}
    </View>
  );
  const ItemsTable = ({ items, incoming }: { items: SignedUniformTermItem[]; incoming: boolean }) => (
    <View style={modernStyles.section}>
      <SectionHeading color="#22B8CF" summary={totalSummary(items)}>
        {incoming ? "Itens devolvidos" : "Itens entregues"}
      </SectionHeading>
      <View style={modernStyles.table}>
        <View style={modernStyles.tableHeader}>
          {["Peça", "Modelo", "Cor", "Tam.", "Qtd", "Condição", ...(incoming ? ["Destino"] : [])].map((label, index) => (
            <TableCell key={label} width={widths[index]}>
              <Text style={modernStyles.tableHeaderText}>{label}</Text>
            </TableCell>
          ))}
        </View>
        {items.map((item, index) => (
          <View key={`${item.productName}-${index}`} style={modernStyles.tableRow} wrap={false}>
            <TableCell width={widths[0]} strong>{item.productName}</TableCell>
            <TableCell width={widths[1]}>{itemModel(item)}</TableCell>
            <TableCell width={widths[2]}>{item.apparelColor || "-"}</TableCell>
            <TableCell width={widths[3]}>{item.apparelSize || "-"}</TableCell>
            <TableCell width={widths[4]}>{item.quantity}</TableCell>
            <TableCell width={widths[5]}><ConditionBadge condition={item.condition} /></TableCell>
            {incoming ? <TableCell width={widths[6]}>{shortDisposition(item.stockDisposition)}</TableCell> : null}
          </View>
        ))}
      </View>
    </View>
  );
  const ExchangeColumn = ({
    items,
    incoming,
  }: {
    items: SignedUniformTermItem[];
    incoming: boolean;
  }) => (
    <View style={modernStyles.exchangeColumn}>
      <SectionHeading color={incoming ? "#F59E0B" : "#22C55E"} summary={`${items.length} ${items.length === 1 ? "item" : "itens"}`}>
        {incoming ? "Devolvidos na troca" : "Entregues na troca"}
      </SectionHeading>
      <View style={modernStyles.exchangeCard}>
        {items.map((item, index) => (
          <View
            key={`${item.productName}-${index}`}
            style={index < items.length - 1 ? [modernStyles.exchangeItem, modernStyles.exchangeItemBorder] : modernStyles.exchangeItem}
            wrap={false}
          >
            <View style={modernStyles.exchangeItemContent}>
              <Text style={modernStyles.exchangeItemName}>{item.productName}</Text>
              <Text style={modernStyles.exchangeItemDetails}>
                {[itemModel(item), item.apparelColor, item.apparelSize, `${item.quantity} un`].filter(Boolean).join(" · ")}
              </Text>
              {incoming ? <Text style={modernStyles.exchangeItemDestination}>Destino: {shortDisposition(item.stockDisposition).toLocaleLowerCase("pt-BR")}</Text> : null}
            </View>
            <ConditionBadge condition={item.condition} />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <Document title={`${title} - ${collaboratorName}`} author="Coala One">
      <Page size="A4" style={modernStyles.page}>
        {letterheadDataUri
          ? <Image fixed style={styles.letterheadBackground} src={letterheadDataUri} />
          : logoDataUri
            ? <Image fixed style={styles.letterheadBackground} src={logoDataUri} />
            : null}
        {preview ? (
          <>
            <Text fixed style={styles.previewNoticeTop}>PRÉVIA COM DADOS FICTÍCIOS — SEM VALIDADE</Text>
            <Text fixed style={styles.previewNoticeBottom}>PRÉVIA COM DADOS FICTÍCIOS — SEM VALIDADE</Text>
            <Text fixed style={styles.previewWatermark}>PRÉVIA COM DADOS FICTÍCIOS — SEM VALIDADE</Text>
          </>
        ) : null}
        <View style={modernStyles.meta}>
          <Text style={modernStyles.pagePill}>PÁGINA 1 DE 1</Text>
          <Text style={modernStyles.movementPill}>MOVIMENTAÇÃO DE UNIFORME</Text>
        </View>
        <View style={modernStyles.headingBlock}>
          <Text style={modernStyles.heading}>{title}</Text>
          <Text style={modernStyles.headingSubtitle}>Registro eletrônico de movimentação e responsabilidade de uniformes.</Text>
        </View>

        <Identification />

        {type === "exchange"
          ? (
              <View style={[modernStyles.section, modernStyles.exchangeColumns]}>
                <ExchangeColumn incoming items={incomingItems} />
                <ExchangeColumn incoming={false} items={outgoingItems} />
              </View>
            )
          : type === "delivery"
            ? <ItemsTable items={outgoingItems} incoming={false} />
            : <ItemsTable items={incomingItems} incoming />}

        <View style={modernStyles.section}>
          <SectionHeading color="#94A3B8">Declaração e ressalvas</SectionHeading>
          <View style={modernStyles.declarationBox}>
            <Text>{declaration}</Text>
            {notes ? <Text style={modernStyles.notes}>Ressalvas: {notes}</Text> : null}
          </View>
        </View>

        <View style={modernStyles.signatures}>
          <View style={modernStyles.signature}>
            {collaboratorSignature
              ? <Image style={modernStyles.signatureImage} src={collaboratorSignature} />
              : <View style={modernStyles.signatureImage} />}
            <View style={modernStyles.signatureLine}>
              <Text style={modernStyles.signatureName}>{collaboratorName}</Text>
              <Text style={modernStyles.signatureRole}>Colaborador</Text>
            </View>
          </View>
          <View style={modernStyles.signature}>
            {responsibleSignature
              ? <Image style={modernStyles.signatureImage} src={responsibleSignature} />
              : <View style={modernStyles.signatureImage} />}
            <View style={modernStyles.signatureLine}>
              <Text style={modernStyles.signatureName}>{registeredByName}</Text>
              <Text style={modernStyles.signatureRole}>Responsável pela movimentação</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
