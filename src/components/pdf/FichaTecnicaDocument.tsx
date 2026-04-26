
"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

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
    fontSize: 18,
    marginBottom: 2,
    fontWeight: 'bold',
    fontFamily: 'Helvetica-Bold',
  },
  subHeader: {
    fontSize: 9,
    color: '#666',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#F3F4F6',
    padding: 6,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginTop: 15,
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
    padding: 5,
  },
  tableCol: {
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderLeftWidth: 0,
    borderTopWidth: 0,
    padding: 5,
  },
  tableCell: {
    margin: 'auto',
    marginTop: 5,
    fontSize: 10,
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
   infoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 3,
    padding: 8,
    flexGrow: 1,
  },
  infoCardLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginBottom: 2,
  },
  infoCardValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  cardGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10
  },
});

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

interface DocumentProps {
  type?: 'instrucao' | 'completa';
  data: {
    name: string;
    ppo?: { 
      sku?: string;
      assemblyInstructions?: { id: string; name: string; etapas: { id: string; text: string; quantity?: number; unit?: string }[] }[];
      preparationTime?: number;
      portionWeight?: number;
      portionTolerance?: number;
      allergens?: { id: string; text: string }[];
    };
    salePrice: number;
    totalCmv: number;
    profitPercentage: number;
    markup: number;
    ingredients: { name: string; quantity: number; unit: string }[];
  }
}

export const FichaTecnicaDocument = ({ data, type = 'instrucao' }: DocumentProps) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <Text style={{ fontSize: 10, color: '#3B82F6', fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>Sistema - Coala</Text>
      <Text style={styles.header}>{data.name}</Text>
      <Text style={styles.subHeader}>SKU: {data.ppo?.sku || 'N/A'}</Text>
      
      {type === 'completa' && (
        <View style={styles.cardGrid}>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardLabel}>Preço de Venda</Text>
            <Text style={styles.infoCardValue}>{formatCurrency(data.salePrice)}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardLabel}>Custo (CMV)</Text>
            <Text style={styles.infoCardValue}>{formatCurrency(data.totalCmv)}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardLabel}>Margem Bruta (R$)</Text>
            <Text style={styles.infoCardValue}>{formatCurrency((data.salePrice || 0) - (data.totalCmv || 0))}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardLabel}>M. Contribuição</Text>
            <Text style={styles.infoCardValue}>{data.profitPercentage?.toFixed(1) || 0}%</Text>
          </View>
        </View>
      )}
      
      <View style={styles.cardGrid}>
        <View style={styles.infoCard}>
          <Text style={styles.infoCardLabel}>Tempo de Montagem</Text>
          <Text style={styles.infoCardValue}>{data.ppo?.preparationTime || 0}s</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoCardLabel}>Peso</Text>
          <Text style={styles.infoCardValue}>
            {data.ppo?.portionWeight || 0}g {data.ppo?.portionTolerance ? `(±${data.ppo.portionTolerance}g)` : ''}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Composição</Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <View style={[styles.tableColHeader, { width: '70%' }]}>
            <Text style={styles.tableCell}>Ingrediente</Text>
          </View>
          <View style={[styles.tableColHeader, { width: '30%' }]}>
            <Text style={styles.tableCell}>Quantidade</Text>
          </View>
        </View>
        {data.ingredients.map((ing: any) => (
          <View style={styles.tableRow} key={ing.name}>
            <View style={[styles.tableCol, { width: '70%' }]}>
              <Text style={styles.tableCell}>{ing.name}</Text>
            </View>
            <View style={[styles.tableCol, { width: '30%' }]}>
              <Text style={styles.tableCell}>{ing.quantity} {ing.unit}</Text>
            </View>
          </View>
        ))}
      </View>

      {data.ppo?.assemblyInstructions && data.ppo.assemblyInstructions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Modo de Montagem</Text>
          {data.ppo.assemblyInstructions.map((phase) => (
            <View key={phase.id} style={{ marginTop: 10, marginBottom: 5 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#EF4444', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 2, marginBottom: 5 }}>
                {phase.name}
              </Text>
              {phase.etapas.map((etapa, index) => (
                <View key={etapa.id} style={{ flexDirection: 'row', marginBottom: 3 }}>
                  <Text style={{ width: 15, fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{index + 1}.</Text>
                  <Text style={{ flex: 1, fontSize: 9 }}>{etapa.text}</Text>
                </View>
              ))}
            </View>
          ))}
        </>
      )}

      {data.ppo?.allergens && data.ppo.allergens.length > 0 && (
        <View style={{ marginTop: 20, padding: 8, backgroundColor: '#FFF7ED', borderRadius: 3, borderLeftWidth: 3, borderLeftColor: '#F97316' }}>
          <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#9A3412', marginBottom: 2 }}>Alergênicos:</Text>
          <Text style={{ fontSize: 9, color: '#C2410C' }}>
            {data.ppo.allergens.map((a: any) => typeof a === 'string' ? a : a.text).join(', ')}
          </Text>
        </View>
      )}

      <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
        `Página ${pageNumber} de ${totalPages}`
      )} fixed />
    </Page>
  </Document>
);
