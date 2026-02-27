"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { type ProductSimulation } from '@/types';
import { format } from 'date-fns';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    paddingTop: 30,
    paddingLeft: 20,
    paddingRight: 20,
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
    padding: 4,
    fontFamily: 'Helvetica-Bold',
  },
  tableCol: {
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 0,
    borderTopWidth: 0,
    padding: 4,
  },
  tableCell: {
    fontSize: 7,
  },
  footer: {
    position: 'absolute',
    bottom: 25,
    left: 30,
    right: 30,
    textAlign: 'center',
    color: 'grey',
    fontSize: 8,
  },
  textRight: {
      textAlign: 'right',
  },
  textCenter: {
      textAlign: 'center',
  }
});

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

interface DocumentProps {
  data: ProductSimulation[];
}

export const GerencialReportDocument = ({ data }: DocumentProps) => (
  <Document>
    <Page size="A4" orientation="landscape" style={styles.page}>
      <Text style={styles.header}>Relatório Gerencial de Análise de Custo</Text>
      <Text style={styles.subHeader}>Gerado em: {format(new Date(), 'dd/MM/yyyy HH:mm')}</Text>
      
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={[styles.tableColHeader, { width: '20%' }]}><Text style={styles.tableCell}>Mercadoria</Text></View>
          <View style={[styles.tableColHeader, { width: '7%' }]}><Text style={styles.tableCell}>SKU</Text></View>
          <View style={[styles.tableColHeader, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>Preço Venda</Text></View>
          <View style={[styles.tableColHeader, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>CMV</Text></View>
          <View style={[styles.tableColHeader, { width: '9%', ...styles.textRight }]}><Text style={styles.tableCell}>M. Bruta (R$)</Text></View>
          <View style={[styles.tableColHeader, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>M. Bruta (%)</Text></View>
          <View style={[styles.tableColHeader, { width: '10%', ...styles.textRight }]}><Text style={styles.tableCell}>M. Contrib (R$)</Text></View>
          <View style={[styles.tableColHeader, { width: '9%', ...styles.textRight }]}><Text style={styles.tableCell}>M. Contrib (%)</Text></View>
          <View style={[styles.tableColHeader, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>Markup</Text></View>
          <View style={[styles.tableColHeader, { width: '13%', ...styles.textRight }]}><Text style={styles.tableCell}>Meta Lucro (%)</Text></View>
        </View>

        {data.map((sim, index) => {
          const grossMarginValue = sim.salePrice - sim.totalCmv;
          const grossMarginPercentage = sim.salePrice > 0 ? (grossMarginValue / sim.salePrice) * 100 : 0;

          return (
            <View style={styles.tableRow} key={sim.id} wrap={false}>
              <View style={[styles.tableCol, { width: '20%' }]}><Text style={styles.tableCell}>{sim.name}</Text></View>
              <View style={[styles.tableCol, { width: '7%' }]}><Text style={styles.tableCell}>{sim.ppo?.sku || 'N/A'}</Text></View>
              <View style={[styles.tableCol, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>{formatCurrency(sim.salePrice)}</Text></View>
              <View style={[styles.tableCol, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>{formatCurrency(sim.totalCmv)}</Text></View>
              <View style={[styles.tableCol, { width: '9%', ...styles.textRight }]}><Text style={styles.tableCell}>{formatCurrency(grossMarginValue)}</Text></View>
              <View style={[styles.tableCol, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>{grossMarginPercentage.toFixed(2)}%</Text></View>
              <View style={[styles.tableCol, { width: '10%', ...styles.textRight }]}><Text style={styles.tableCell}>{formatCurrency(sim.profitValue)}</Text></View>
              <View style={[styles.tableCol, { width: '9%', ...styles.textRight }]}><Text style={styles.tableCell}>{sim.profitPercentage.toFixed(2)}%</Text></View>
              <View style={[styles.tableCol, { width: '8%', ...styles.textRight }]}><Text style={styles.tableCell}>{sim.markup.toFixed(2)}x</Text></View>
              <View style={[styles.tableCol, { width: '13%', ...styles.textRight }]}><Text style={styles.tableCell}>{sim.profitGoal ? `${sim.profitGoal}%` : '-'}</Text></View>
            </View>
          );
        })}
      </View>

      <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
        `Página ${pageNumber} de ${totalPages}`
      )} fixed />
    </Page>
  </Document>
);
