
"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Link } from '@react-pdf/renderer';

function fmtTime(s: number) {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

function fmtWeight(g: number) {
  return g >= 1000 ? `${(g / 1000).toFixed(1)}kg` : `${g}g`;
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
  headerBrand: {
    fontSize: 7,
    color: '#3B82F6',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 2,
  },
  headerSub: {
    fontSize: 9,
    color: '#6B7280',
    marginBottom: 14,
  },
  body: {
    flexDirection: 'row',
    gap: 14,
  },
  leftCol: {
    width: 155,
    flexShrink: 0,
  },
  rightCol: {
    flex: 1,
  },
  imageBox: {
    width: 155,
    height: 207,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
  },
  productImage: {
    width: 155,
    height: 207,
    objectFit: 'cover',
  },
  noImageBox: {
    width: 155,
    height: 207,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  noImageText: {
    fontSize: 8,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  metricCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
  },
  metricCardAllergen: {
    width: '47%',
    backgroundColor: '#FFF7ED',
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderStyle: 'solid',
  },
  metricLabel: {
    fontSize: 6,
    color: '#9CA3AF',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  metricLabelAllergen: {
    fontSize: 6,
    color: '#C2410C',
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  metricValueAllergen: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#9A3412',
    textAlign: 'center',
  },
  nutritionalBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
    overflow: 'hidden',
  },
  nutritionalHeader: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  nutritionalHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
  },
  nutritionalBody: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  nutritionalBodyText: {
    fontSize: 8,
    color: '#9CA3AF',
  },
  sectionHeader: {
    borderBottomWidth: 2,
    borderBottomColor: '#3B82F6',
    paddingBottom: 4,
    marginBottom: 8,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  emptyBox: {
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    borderRadius: 8,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 8,
    color: '#9CA3AF',
  },
  phaseContainer: {
    marginBottom: 8,
  },
  phaseTag: {
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 5,
    alignSelf: 'flex-start',
  },
  phaseTagText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#1D4ED8',
  },
  stepCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderStyle: 'solid',
    marginBottom: 4,
    alignItems: 'flex-start',
    gap: 8,
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 5,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumberText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
  },
  stepText: {
    flex: 1,
    fontSize: 9,
    color: '#1F2937',
    paddingTop: 2,
  },
  qualityBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
    overflow: 'hidden',
    marginBottom: 8,
  },
  qualityHeader: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  qualityHeaderText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#FFFFFF',
  },
  qualityItem: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
    alignItems: 'flex-start',
    gap: 6,
  },
  qualityBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    marginTop: 2,
    flexShrink: 0,
  },
  qualityText: {
    fontSize: 8,
    color: '#1F2937',
    flex: 1,
  },
  ingredientsBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    marginBottom: 8,
  },
  ingredientsHeader: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  ingredientsHeaderText: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
  },
  ingredientsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  ingredientCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'solid',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  ingredientName: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    flex: 1,
  },
  ingredientQty: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#2563EB',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  videoLinkBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    padding: 10,
    borderWidth: 2,
    borderColor: '#BFDBFE',
    borderStyle: 'solid',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  videoIconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  videoIconText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
  },
  videoTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1E3A8A',
    marginBottom: 2,
  },
  videoLink: {
    fontSize: 8,
    color: '#3B82F6',
    textDecoration: 'underline',
  },
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

interface DocumentProps {
  type?: 'instrucao' | 'completa';
  data: {
    name: string;
    ppo?: {
      sku?: string;
      referenceImageUrl?: string;
      assemblyVideoUrl?: string;
      assemblyInstructions?: { id: string; name: string; etapas: { id: string; text: string; quantity?: number; unit?: string }[] }[];
      preparationTime?: number;
      portionWeight?: number;
      portionTolerance?: number;
      allergens?: { id: string; text: string }[];
      qualityStandard?: { id: string; text: string }[];
    };
    salePrice: number;
    totalCmv: number;
    profitPercentage: number;
    markup: number;
    ingredients: { name: string; quantity: number; unit: string }[];
  }
}

export const FichaTecnicaDocument = ({ data }: DocumentProps) => {
  const allergenText = data.ppo?.allergens?.length
    ? data.ppo.allergens.map((a: any) => typeof a === 'string' ? a : a.text).join(', ')
    : 'Nenhum';
  const assemblyInstructions: any[] = data.ppo?.assemblyInstructions ?? [];
  const qualityStandard: any[] = data.ppo?.qualityStandard ?? [];
  const videoUrl = data.ppo?.assemblyVideoUrl || null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.headerBrand}>Sistema — Coala</Text>
        <Text style={styles.headerTitle}>{data.name}</Text>
        <Text style={styles.headerSub}>
          Ficha Técnica de Instrução  ·  SKU: {data.ppo?.sku || 'N/A'}
        </Text>

        <View style={styles.body}>
          {/* LEFT COLUMN */}
          <View style={styles.leftCol}>
            {data.ppo?.referenceImageUrl ? (
              <View style={styles.imageBox}>
                <Image src={data.ppo.referenceImageUrl} style={styles.productImage} />
              </View>
            ) : (
              <View style={styles.noImageBox}>
                <Text style={styles.noImageText}>{data.name}</Text>
              </View>
            )}

            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Tempo</Text>
                <Text style={styles.metricValue}>
                  {data.ppo?.preparationTime ? fmtTime(data.ppo.preparationTime) : '—'}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Peso</Text>
                <Text style={styles.metricValue}>
                  {data.ppo?.portionWeight ? fmtWeight(data.ppo.portionWeight) : '—'}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Tolerância</Text>
                <Text style={styles.metricValue}>
                  {data.ppo?.portionTolerance ? `±${data.ppo.portionTolerance}g` : '—'}
                </Text>
              </View>
              <View style={styles.metricCardAllergen}>
                <Text style={styles.metricLabelAllergen}>Alergênicos</Text>
                <Text style={styles.metricValueAllergen}>{allergenText}</Text>
              </View>
            </View>

            <View style={styles.nutritionalBox}>
              <View style={styles.nutritionalHeader}>
                <Text style={styles.nutritionalHeaderText}>Tabela Nutricional</Text>
              </View>
              <View style={styles.nutritionalBody}>
                <Text style={styles.nutritionalBodyText}>Em breve</Text>
              </View>
            </View>
          </View>

          {/* RIGHT COLUMN */}
          <View style={styles.rightCol}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>Passo a Passo de Montagem</Text>
            </View>

            {assemblyInstructions.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>Sem instruções cadastradas</Text>
              </View>
            ) : (
              assemblyInstructions.map((phase: any) => (
                <View key={phase.id} style={styles.phaseContainer}>
                  <View style={styles.phaseTag}>
                    <Text style={styles.phaseTagText}>{phase.name}</Text>
                  </View>
                  {phase.etapas.map((step: any, si: number) => (
                    <View key={step.id} style={styles.stepCard}>
                      <View style={styles.stepNumber}>
                        <Text style={styles.stepNumberText}>{si + 1}</Text>
                      </View>
                      <Text style={styles.stepText}>{step.text}</Text>
                    </View>
                  ))}
                </View>
              ))
            )}

            {qualityStandard.length > 0 && (
              <View style={styles.qualityBox}>
                <View style={styles.qualityHeader}>
                  <Text style={styles.qualityHeaderText}>Padrão de Qualidade</Text>
                </View>
                {qualityStandard.map((item: any) => (
                  <View key={item.id} style={styles.qualityItem}>
                    <View style={styles.qualityBullet} />
                    <Text style={styles.qualityText}>{item.text}</Text>
                  </View>
                ))}
              </View>
            )}

            {data.ingredients.length > 0 && (
              <View style={styles.ingredientsBox}>
                <View style={styles.ingredientsHeader}>
                  <Text style={styles.ingredientsHeaderText}>CHECKLIST DE INGREDIENTES</Text>
                </View>
                <View style={styles.ingredientsGrid}>
                  {data.ingredients.map((ing: any) => (
                    <View key={ing.name} style={styles.ingredientCard}>
                      <Text style={styles.ingredientName}>{ing.name}</Text>
                      <Text style={styles.ingredientQty}>
                        {ing.quantity} {ing.unit}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {videoUrl && (
              <View style={styles.videoLinkBox}>
                <View style={styles.videoIconBox}>
                  <Text style={styles.videoIconText}>▶</Text>
                </View>
                <View>
                  <Text style={styles.videoTitle}>Vídeo de Montagem</Text>
                  <Link src={videoUrl} style={styles.videoLink}>
                    Clique aqui para ver o vídeo de montagem
                  </Link>
                </View>
              </View>
            )}
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
