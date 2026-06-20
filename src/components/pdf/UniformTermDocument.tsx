"use client";

import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

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

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <View style={styles.row}>
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
