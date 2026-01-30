
"use client";

import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { type RepositionActivity, type Product } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const styles = StyleSheet.create({
    page: {
        fontFamily: 'Helvetica',
        fontSize: 9,
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
    infoSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
        fontSize: 10,
    },
    table: {
        display: "flex",
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
  activity: RepositionActivity;
  products: Product[];
}

export const SeparationListDocument = ({ activity, products }: DocumentProps) => {
    const productMap = new Map(products.map(p => [p.id, p]));

    const allItems = activity.items.flatMap(item => 
        item.suggestedLots.map(lot => {
            const product = productMap.get(lot.productId);
            
            let logisticQuantityDisplay = `${lot.quantityToMove}`;
            let unitQuantityDisplay = `${lot.quantityToMove}`;

            if (product) {
                const packageType = product.packageType || 'un';
                unitQuantityDisplay = `${lot.quantityToMove} ${packageType}(s)`;

                if (product.multiplo_caixa && product.multiplo_caixa > 0 && product.rotulo_caixa) {
                    const totalItems = lot.quantityToMove;
                    const itemsPerBox = product.multiplo_caixa;
                    const fullBoxes = Math.floor(totalItems / itemsPerBox);
                    const remainingItems = totalItems % itemsPerBox;

                    let displayParts = [];
                    if (fullBoxes > 0) {
                        displayParts.push(`${fullBoxes} ${product.rotulo_caixa}(s)`);
                    }
                    if (remainingItems > 0) {
                        displayParts.push(`${remainingItems} ${packageType}(s)`);
                    }
                    logisticQuantityDisplay = displayParts.length > 0 ? displayParts.join(' e ') : `0 ${packageType}(s)`;
                } else {
                    logisticQuantityDisplay = `${lot.quantityToMove} ${packageType}(s)`;
                }
            }

            return {
                baseProductName: item.productName,
                productName: lot.productName,
                lotNumber: lot.lotNumber,
                logisticQuantityDisplay,
                unitQuantityDisplay
            };
        })
    );
    
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Text style={styles.header}>Lista de Separação - Reposição</Text>
                <Text style={styles.subHeader}>ID da Atividade: #{activity.id.slice(-6)}</Text>
                
                <View style={styles.infoSection}>
                    <Text>Origem: {activity.kioskOriginName}</Text>
                    <Text>Destino: {activity.kioskDestinationName}</Text>
                </View>
                <View style={styles.infoSection}>
                    <Text>Data: {activity.createdAt ? format(new Date(activity.createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : 'N/A'}</Text>
                    <Text>Solicitado por: {activity.requestedBy.username}</Text>
                </View>
                
                <View style={styles.table}>
                    <View style={styles.tableRow}>
                        <View style={[styles.tableColHeader, { width: '25%' }]}><Text>Insumo</Text></View>
                        <View style={[styles.tableColHeader, { width: '20%' }]}><Text>Lote</Text></View>
                        <View style={[styles.tableColHeader, { width: '20%', textAlign: 'right' }]}><Text>Qtd. Logística</Text></View>
                        <View style={[styles.tableColHeader, { width: '20%', textAlign: 'right' }]}><Text>Qtd. Unitária</Text></View>
                        <View style={[styles.tableColHeader, { width: '15%', textAlign: 'center' }]}><Text>Conferido</Text></View>
                    </View>

                    {allItems.map((item, index) => (
                        <View style={styles.tableRow} key={item.lotNumber + index}>
                            <View style={[styles.tableCol, { width: '25%' }]}><Text>{item.productName}</Text></View>
                            <View style={[styles.tableCol, { width: '20%' }]}><Text>{item.lotNumber}</Text></View>
                            <View style={[styles.tableCol, { width: '20%', textAlign: 'right' }]}><Text>{item.logisticQuantityDisplay}</Text></View>
                            <View style={[styles.tableCol, { width: '20%', textAlign: 'right' }]}><Text>{item.unitQuantityDisplay}</Text></View>
                            <View style={[styles.tableCol, { width: '15%', textAlign: 'center' }]}><Text>[  ]</Text></View>
                        </View>
                    ))}
                </View>

                <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
                    `Página ${pageNumber} de ${totalPages}`
                )} fixed />
            </Page>
        </Document>
    );
};
