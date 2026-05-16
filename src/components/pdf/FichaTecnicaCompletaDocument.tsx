"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const formatCurrency = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 28,
    paddingLeft: 35,
    paddingRight: 35,
    paddingBottom: 40,
    backgroundColor: '#F9FAFB',
  },
  // ─── Header ──────────────────────────────────────────────
  headerBrand: {
    fontSize: 7,
    color: '#3B82F6',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  headerBadge: {
    backgroundColor: '#2563EB',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  headerBadgeText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 9,
    color: '#6B7280',
    marginBottom: 12,
  },
  // ─── Financial cards ──────────────────────────────────────
  financialRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  financialCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
  },
  financialLabel: {
    fontSize: 6,
    color: '#9CA3AF',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 3,
  },
  financialValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  financialValueGreen: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#16A34A',
  },
  financialValueOrange: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#EA580C',
  },
  // ─── Body (two columns) ───────────────────────────────────
  body: {
    flexDirection: 'row',
    gap: 15,
  },
  leftCol: {
    flex: 1,
  },
  rightCol: {
    width: 185,
    flexShrink: 0,
  },
  // ─── Section boxes ────────────────────────────────────────
  sectionBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
    overflow: 'hidden',
    marginBottom: 10,
  },
  sectionBoxHeader: {
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionBoxHeaderDark: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionBoxTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  sectionBoxTitleWhite: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
  },
  // ─── Composition table ────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#6B7280',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    backgroundColor: '#FAFAFA',
  },
  tableColName: {
    flex: 1,
  },
  tableColQty: {
    width: 70,
  },
  tableColCost: {
    width: 65,
    textAlign: 'right',
  },
  tableCellMain: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#1F2937',
  },
  tableCellSub: {
    fontSize: 6,
    color: '#9CA3AF',
    marginTop: 1,
  },
  tableCellQty: {
    fontSize: 8,
    color: '#4B5563',
    fontFamily: 'Helvetica-Bold',
  },
  tableCellCost: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    textAlign: 'right',
  },
  // ─── Assembly ─────────────────────────────────────────────
  phaseBlock: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  phaseTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#2563EB',
    borderBottomWidth: 1,
    borderBottomColor: '#EFF6FF',
    paddingBottom: 3,
    marginBottom: 5,
  },
  assemblyStep: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  assemblyStepNum: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#D1D5DB',
    width: 12,
    flexShrink: 0,
  },
  assemblyStepText: {
    flex: 1,
    fontSize: 8,
    color: '#374151',
  },
  // ─── Right column sections ────────────────────────────────
  imageBox: {
    width: '100%',
    height: 175,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
  },
  productImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  noImageBox: {
    width: '100%',
    height: 175,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  noImageText: {
    fontSize: 8,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  specLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#6B7280',
  },
  specValue: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  allergenBadge: {
    backgroundColor: '#FFF7ED',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 2,
  },
  allergenBadgeText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#C2410C',
  },
  allergenRow: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  allergenBadgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 3,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  metaLabel: {
    fontSize: 7,
    color: '#6B7280',
  },
  metaValue: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    textAlign: 'right',
    maxWidth: 100,
  },
  fiscalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 10,
  },
  fiscalItem: {
    width: '44%',
  },
  fiscalLabel: {
    fontSize: 6,
    color: '#9CA3AF',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 1,
  },
  fiscalValue: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  nutritionalBody: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  nutritionalBodyText: {
    fontSize: 8,
    color: '#9CA3AF',
  },
  notesBox: {
    backgroundColor: '#FEFCE8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEF08A',
    borderStyle: 'solid',
    padding: 8,
    marginBottom: 10,
  },
  notesLabel: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    color: '#A16207',
    marginBottom: 3,
  },
  notesText: {
    fontSize: 8,
    color: '#713F12',
    fontStyle: 'italic',
  },
  // ─── Footer ───────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 35,
    right: 35,
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 7,
  },
});

interface FichaTecnicaCompletaDocumentProps {
  data: {
    name: string;
    ppo?: {
      sku?: string;
      referenceImageUrl?: string;
      preparationTime?: number;
      portionWeight?: number;
      allergens?: any[];
      assemblyInstructions?: { id: string; name: string; etapas: { id: string; text: string; quantity?: number; unit?: string }[] }[];
      ncm?: string;
      cest?: string;
      cfop?: string;
    };
    salePrice: number;
    totalCmv: number;
    profitPercentage: number;
    profitGoal?: number;
    markup: number;
    kioskIds?: string[];
    categoryName?: string;
    lineName?: string;
    notes?: string;
    ingredients: { name: string; quantity: number; unit: string; cost: number }[];
  };
}

export const FichaTecnicaCompletaDocument = ({ data }: FichaTecnicaCompletaDocumentProps) => {
  const grossMargin = (data.salePrice || 0) - (data.totalCmv || 0);
  const grossMarginPct = data.salePrice > 0
    ? (((data.salePrice - data.totalCmv) / data.salePrice) * 100).toFixed(1)
    : '0.0';
  const metAtGoal = data.profitGoal && data.profitPercentage >= data.profitGoal;

  const allergens: any[] = Array.isArray(data.ppo?.allergens)
    ? data.ppo!.allergens.map((a: any) => typeof a === 'string' ? a : a.text)
    : [];

  const assemblyInstructions: any[] = data.ppo?.assemblyInstructions ?? [];

  const hasFiscal = data.ppo?.ncm || data.ppo?.cest || data.ppo?.cfop || data.profitGoal;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <Text style={styles.headerBrand}>Sistema — Coala</Text>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{data.name}</Text>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>FICHA TÉCNICA COMPLETA</Text>
          </View>
        </View>
        <Text style={styles.headerSub}>SKU: {data.ppo?.sku || 'N/A'}</Text>

        {/* Financial cards */}
        <View style={styles.financialRow}>
          <View style={styles.financialCard}>
            <Text style={styles.financialLabel}>Preço de Venda</Text>
            <Text style={styles.financialValue}>{formatCurrency(data.salePrice)}</Text>
          </View>
          <View style={styles.financialCard}>
            <Text style={styles.financialLabel}>Custo (CMV)</Text>
            <Text style={styles.financialValue}>{formatCurrency(data.totalCmv)}</Text>
          </View>
          <View style={styles.financialCard}>
            <Text style={styles.financialLabel}>Margem Bruta R$</Text>
            <Text style={styles.financialValue}>{formatCurrency(grossMargin)}</Text>
          </View>
          <View style={styles.financialCard}>
            <Text style={styles.financialLabel}>Margem Bruta %</Text>
            <Text style={styles.financialValue}>{grossMarginPct}%</Text>
          </View>
          <View style={styles.financialCard}>
            <Text style={styles.financialLabel}>M. Contribuição</Text>
            <Text style={metAtGoal ? styles.financialValueGreen : styles.financialValueOrange}>
              {data.profitPercentage?.toFixed(1) || '0.0'}%
            </Text>
          </View>
          <View style={styles.financialCard}>
            <Text style={styles.financialLabel}>Markup</Text>
            <Text style={styles.financialValue}>{data.markup?.toFixed(2) || '0.00'}x</Text>
          </View>
        </View>

        {/* Body */}
        <View style={styles.body}>
          {/* LEFT COLUMN */}
          <View style={styles.leftCol}>
            {/* Composição e Custos */}
            <View style={styles.sectionBox}>
              <View style={styles.sectionBoxHeader}>
                <Text style={styles.sectionBoxTitle}>Composição e Custos</Text>
              </View>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Item</Text>
                <Text style={[styles.tableHeaderCell, { width: 70 }]}>Quantidade</Text>
                <Text style={[styles.tableHeaderCell, { width: 65, textAlign: 'right' }]}>Custo Total</Text>
              </View>
              {data.ingredients.map((ing, i) => (
                <View key={ing.name + i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <View style={styles.tableColName}>
                    <Text style={styles.tableCellMain}>{ing.name}</Text>
                  </View>
                  <View style={styles.tableColQty}>
                    <Text style={styles.tableCellQty}>{ing.quantity} {ing.unit}</Text>
                  </View>
                  <View style={styles.tableColCost}>
                    <Text style={styles.tableCellCost}>{formatCurrency(ing.quantity * ing.cost)}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Modo de Montagem */}
            {assemblyInstructions.length > 0 && (
              <View style={styles.sectionBox}>
                <View style={styles.sectionBoxHeader}>
                  <Text style={styles.sectionBoxTitle}>Modo de Montagem</Text>
                </View>
                {assemblyInstructions.map((phase: any) => (
                  <View key={phase.id} style={styles.phaseBlock}>
                    <Text style={styles.phaseTitle}>{phase.name}</Text>
                    {phase.etapas.map((step: any, si: number) => (
                      <View key={step.id} style={styles.assemblyStep}>
                        <Text style={styles.assemblyStepNum}>{si + 1}.</Text>
                        <Text style={styles.assemblyStepText}>{step.text}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* RIGHT COLUMN */}
          <View style={styles.rightCol}>
            {/* Product image */}
            {data.ppo?.referenceImageUrl ? (
              <View style={styles.imageBox}>
                <Image src={data.ppo.referenceImageUrl} style={styles.productImage} />
              </View>
            ) : (
              <View style={styles.noImageBox}>
                <Text style={styles.noImageText}>{data.name}</Text>
              </View>
            )}

            {/* Specs */}
            <View style={styles.sectionBox}>
              <View style={styles.sectionBoxHeader}>
                <Text style={styles.sectionBoxTitle}>Especificações</Text>
              </View>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Preparo</Text>
                <Text style={styles.specValue}>
                  {data.ppo?.preparationTime ? fmtTime(data.ppo.preparationTime) : '—'}
                </Text>
              </View>
              <View style={styles.specRow}>
                <Text style={styles.specLabel}>Peso</Text>
                <Text style={styles.specValue}>
                  {data.ppo?.portionWeight ? `${data.ppo.portionWeight}g` : '—'}
                </Text>
              </View>
              {allergens.length > 0 ? (
                <View style={styles.allergenRow}>
                  <Text style={styles.specLabel}>Alergênicos</Text>
                  <View style={styles.allergenBadgesContainer}>
                    {allergens.map((a: string, i: number) => (
                      <View key={i} style={styles.allergenBadge}>
                        <Text style={styles.allergenBadgeText}>{a}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.specRow}>
                  <Text style={styles.specLabel}>Alergênicos</Text>
                  <Text style={styles.specValue}>Nenhum</Text>
                </View>
              )}
            </View>

            {/* Localização e Categoria */}
            <View style={styles.sectionBox}>
              <View style={styles.sectionBoxHeader}>
                <Text style={styles.sectionBoxTitle}>Localização e Categoria</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Quiosques</Text>
                <Text style={styles.metaValue}>
                  {data.kioskIds?.length ? data.kioskIds.join(', ') : 'Todos'}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Categoria</Text>
                <Text style={styles.metaValue}>{data.categoryName || '—'}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Linha</Text>
                <Text style={styles.metaValue}>{data.lineName || '—'}</Text>
              </View>
            </View>

            {/* Dados Fiscais */}
            {hasFiscal && (
              <View style={styles.sectionBox}>
                <View style={styles.sectionBoxHeader}>
                  <Text style={styles.sectionBoxTitle}>Dados Fiscais e Taxas</Text>
                </View>
                <View style={styles.fiscalGrid}>
                  {data.ppo?.ncm && (
                    <View style={styles.fiscalItem}>
                      <Text style={styles.fiscalLabel}>NCM</Text>
                      <Text style={styles.fiscalValue}>{data.ppo.ncm}</Text>
                    </View>
                  )}
                  {data.ppo?.cest && (
                    <View style={styles.fiscalItem}>
                      <Text style={styles.fiscalLabel}>CEST</Text>
                      <Text style={styles.fiscalValue}>{data.ppo.cest}</Text>
                    </View>
                  )}
                  {data.ppo?.cfop && (
                    <View style={styles.fiscalItem}>
                      <Text style={styles.fiscalLabel}>CFOP</Text>
                      <Text style={styles.fiscalValue}>{data.ppo.cfop}</Text>
                    </View>
                  )}
                  {data.profitGoal && (
                    <View style={styles.fiscalItem}>
                      <Text style={styles.fiscalLabel}>Meta M.B.</Text>
                      <Text style={styles.fiscalValue}>{data.profitGoal}%</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Observações */}
            {data.notes && (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>Observações</Text>
                <Text style={styles.notesText}>"{data.notes}"</Text>
              </View>
            )}

            {/* Tabela Nutricional placeholder */}
            <View style={styles.sectionBox}>
              <View style={styles.sectionBoxHeaderDark}>
                <Text style={styles.sectionBoxTitleWhite}>Tabela Nutricional</Text>
              </View>
              <View style={styles.nutritionalBody}>
                <Text style={styles.nutritionalBodyText}>Módulo em breve</Text>
              </View>
            </View>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Sistema Coala  ·  Página ${pageNumber} de ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
};
