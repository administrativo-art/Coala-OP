
"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { z } from 'zod';
import { type ConsumptionAnalysisOutputSchema } from '@/ai/flows/consumption-schemas';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 30,
    paddingLeft: 40,
    paddingRight: 40,
    paddingBottom: 50,
    lineHeight: 1.5,
  },
  header: {
    fontSize: 16,
    marginBottom: 5,
    textAlign: 'center',
    fontFamily: 'Helvetica-Bold',
  },
  subHeader: {
    fontSize: 10,
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#F3F4F6',
    padding: 6,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    color: '#111827',
  },
  sectionContent: {
      padding: 8,
      borderWidth: 1,
      borderColor: '#E5E7EB',
      borderTopWidth: 0,
      borderBottomLeftRadius: 3,
      borderBottomRightRadius: 3,
  },
  fieldContainer: {
      marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#4B5563',
  },
  fieldValue: {
    fontSize: 10,
    color: '#1F2937',
  },
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 40,
    right: 40,
    textAlign: 'center',
    color: 'grey',
    fontSize: 8,
  },
});

interface DocumentProps {
  analysisResult: z.infer<typeof ConsumptionAnalysisOutputSchema>;
  kioskName: string;
  period: string;
}

export const AiAnalysisDocument = ({ analysisResult, kioskName, period }: DocumentProps) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Análise de Consumo por IA</Text>
      <Text style={styles.subHeader}>Quiosque: {kioskName} | Período: {period}</Text>
      
      {analysisResult.detailedAnalysis.map((item, index) => (
        <View key={index} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{item.product}</Text>
            <View style={styles.sectionContent}>
                <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Comportamento do consumo médio:</Text>
                    <Text style={styles.fieldValue}>{item.averageConsumptionBehavior}</Text>
                </View>
                 <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Comparação período x histórico:</Text>
                    <Text style={styles.fieldValue}>{item.periodVsHistoricalComparison}</Text>
                </View>
                 <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Tendência na série mensal:</Text>
                    <Text style={styles.fieldValue}>{item.monthlySeriesTrend}</Text>
                </View>
                 <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Volatilidade e estabilidade:</Text>
                    <Text style={styles.fieldValue}>{item.volatilityAndStability}</Text>
                </View>
                <View style={styles.fieldContainer}>
                    <Text style={styles.fieldLabel}>Síntese analítica:</Text>
                    <Text style={styles.fieldValue}>{item.analyticalSynthesis}</Text>
                </View>
            </View>
        </View>
      ))}

      <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
        `Página ${pageNumber} de ${totalPages}`
      )} fixed />
    </Page>
  </Document>
);
