
"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { type AnalysisResult } from '../restock-analysis';

// Registrar fontes (opcional, mas recomendado para consistência)
// Font.register({
//   family: 'Inter',
//   fonts: [
//     { src: '/fonts/Inter-Regular.ttf' },
//     { src: '/fonts/Inter-Bold.ttf', fontWeight: 'bold' },
//   ],
// });

// Estilos para o documento PDF
const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingTop: 30,
    paddingLeft: 40,
    paddingRight: 40,
    paddingBottom: 50,
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
  table: {
    display: 'flex',
    width: 'auto',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableColHeader: {
    backgroundColor: '#F3F4F6',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 0,
    borderTopWidth: 0,
    padding: 6,
    fontFamily: 'Helvetica-Bold',
  },
  tableCol: {
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 0,
    borderTopWidth: 0,
    padding: 6,
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
  data: AnalysisResult[];
  kioskName: string;
}

export const RestockAnalysisDocument = ({ data, kioskName }: DocumentProps) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.header}>Análise de Reposição de Estoque</Text>
      <Text style={styles.subHeader}>Quiosque: {kioskName}</Text>
      
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={[styles.tableColHeader, { width: '40%' }]}><Text>Produto Base</Text></View>
          <View style={[styles.tableColHeader, { width: '15%', textAlign: 'right' }]}><Text>Estoque Mínimo</Text></View>
          <View style={[styles.tableColHeader, { width: '15%', textAlign: 'right' }]}><Text>Estoque Atual</Text></View>
          <View style={[styles.tableColHeader, { width: '15%', textAlign: 'right' }]}><Text>Repor</Text></View>
          <View style={[styles.tableColHeader, { width: '15%', textAlign: 'center' }]}><Text>Status</Text></View>
        </View>

        {data.map((item, index) => (
          <View style={styles.tableRow} key={index}>
            <View style={[styles.tableCol, { width: '40%' }]}><Text>{item.baseProduct.name}</Text></View>
            <View style={[styles.tableCol, { width: '15%', textAlign: 'right' }]}><Text>{item.minimumStock > 0 ? `${item.minimumStock} ${item.baseProduct.unit}` : '-'}</Text></View>
            <View style={[styles.tableCol, { width: '15%', textAlign: 'right' }]}><Text>{item.currentStock.toFixed(2)} {item.baseProduct.unit}</Text></View>
            <View style={[styles.tableCol, { width: '15%', textAlign: 'right', fontFamily: 'Helvetica-Bold', color: '#EF4444' }]}>
                <Text>{item.restockNeeded > 0 ? `${item.restockNeeded.toFixed(2)} ${item.baseProduct.unit}` : '-'}</Text>
            </View>
            <View style={[styles.tableCol, { width: '15%', textAlign: 'center' }]}>
                <Text>{item.hasConversionError ? "Erro" : item.status === 'ok' ? 'OK' : item.status === 'repor' ? 'Repor' : 'Sem Meta'}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
        `Gerado em ${new Date().toLocaleDateString('pt-BR')} - Página ${pageNumber} de ${totalPages}`
      )} fixed />
    </Page>
  </Document>
);
