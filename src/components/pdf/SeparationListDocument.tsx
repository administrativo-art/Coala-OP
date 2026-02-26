
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
        paddingBottom: 60,
        lineHeight: 1.5,
    },
    header: {
        fontSize: 16,
        marginBottom: 5,
        textAlign: 'center',
        fontFamily: 'Helvetica-Bold',
        textTransform: 'uppercase',
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
    signatureContainer: {
        position: 'absolute',
        bottom: 70,
        left: 40,
        right: 40,
        textAlign: 'left',
        paddingTop: 20,
    },
    signatureLine: {
        borderTopWidth: 1,
        borderTopColor: '#333',
        borderTopStyle: 'solid',
        width: '50%',
        marginBottom: 5,
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
    // Guard: se activity for inválido, retorna documento vazio
    if (!activity || typeof activity !== 'object') {
        return <Document><Page size="A4"><Text>Dados indisponíveis</Text></Page></Document>;
    }

    const safeProducts = Array.isArray(products) ? products.filter(Boolean) : [];
    const productMap = new Map(safeProducts.map(p => [p.id, p]));

    // Guard: items pode ser undefined/null quando Firestore está offline
    const safeItems = Array.isArray(activity.items) ? activity.items.filter(Boolean) : [];

    const allItems = safeItems.flatMap(item => {
        // Guard: suggestedLots pode ser undefined
        const safeLots = Array.isArray(item?.suggestedLots) ? item.suggestedLots.filter(Boolean) : [];

        return safeLots.map(lot => {
            if (!lot) return null;

            const product = productMap.get(lot.productId);

            let logisticQuantityDisplay = `${lot.quantityToMove ?? 0}`;
            let unitQuantityDisplay = `${lot.quantityToMove ?? 0}`;

            if (product) {
                const packageType = product.packageType || 'un';
                unitQuantityDisplay = `${lot.quantityToMove ?? 0} ${packageType.toLowerCase()}(s)`;

                if (product.multiplo_caixa && product.multiplo_caixa > 0 && product.rotulo_caixa) {
                    const totalItems = lot.quantityToMove ?? 0;
                    const itemsPerBox = product.multiplo_caixa;
                    const fullBoxes = Math.floor(totalItems / itemsPerBox);
                    const remainingItems = totalItems % itemsPerBox;

                    const displayParts = [];
                    if (fullBoxes > 0) displayParts.push(`${fullBoxes} ${product.rotulo_caixa.toLowerCase()}(s)`);
                    if (remainingItems > 0) displayParts.push(`${remainingItems} ${packageType.toLowerCase()}(s)`);
                    logisticQuantityDisplay = displayParts.length > 0 ? displayParts.join(' e ') : `0 ${packageType.toLowerCase()}(s)`;
                } else {
                    logisticQuantityDisplay = `${lot.quantityToMove ?? 0} ${packageType.toLowerCase()}(s)`;
                }
            }

            return {
                baseProductName: item.productName ?? '',
                productName: lot.productName ?? '',
                lotNumber: lot.lotNumber ?? '',
                logisticQuantityDisplay,
                unitQuantityDisplay,
            };
        }).filter(Boolean);
    });

    // Guard: ID e dados do usuário
    const activityIdRaw = activity.id;
    const activityId = typeof activityIdRaw === 'string' ? activityIdRaw : '------';
    const requestedByName = activity.requestedBy?.username ?? 'N/A';
    const originName = activity.kioskOriginName ?? 'N/A';
    const destinationName = activity.kioskDestinationName ?? 'N/A';
    const createdAtDisplay = activity.createdAt
        ? format(new Date(activity.createdAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })
        : 'N/A';

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Text style={styles.header}>LISTA DE SEPARAÇÃO - REPOSIÇÃO</Text>
                <Text style={styles.subHeader}>ID da atividade: #{activityId.slice(-6)}</Text>

                <View style={styles.infoSection}>
                    <Text>Origem: {originName}</Text>
                    <Text>Destino: {destinationName}</Text>
                </View>
                <View style={styles.infoSection}>
                    <Text>Data: {createdAtDisplay}</Text>
                    <Text>Solicitado por: {requestedByName}</Text>
                </View>

                <View style={styles.table}>
                    <View style={styles.tableRow}>
                        <View style={[styles.tableColHeader, { width: '25%' }]}><Text>Insumo</Text></View>
                        <View style={[styles.tableColHeader, { width: '20%' }]}><Text>Lote</Text></View>
                        <View style={[styles.tableColHeader, { width: '20%', textAlign: 'right' }]}><Text>Qtd. unitária</Text></View>
                        <View style={[styles.tableColHeader, { width: '20%', textAlign: 'right' }]}><Text>Qtd. logística</Text></View>
                        <View style={[styles.tableColHeader, { width: '15%', textAlign: 'center' }]}><Text>Conferido</Text></View>
                    </View>

                    {allItems.map((item, index) => (
                        <View style={styles.tableRow} key={(item?.lotNumber ?? '') + index}>
                            <View style={[styles.tableCol, { width: '25%' }]}><Text>{item?.productName ?? ''}</Text></View>
                            <View style={[styles.tableCol, { width: '20%' }]}><Text>{item?.lotNumber ?? ''}</Text></View>
                            <View style={[styles.tableCol, { width: '20%', textAlign: 'right' }]}><Text>{item?.unitQuantityDisplay ?? ''}</Text></View>
                            <View style={[styles.tableCol, { width: '20%', textAlign: 'right' }]}><Text>{item?.logisticQuantityDisplay ?? ''}</Text></View>
                            <View style={[styles.tableCol, { width: '15%', textAlign: 'center' }]}><Text>[  ]</Text></View>
                        </View>
                    ))}
                </View>

                <View style={styles.signatureContainer} fixed>
                    <View style={styles.signatureLine} />
                    <Text>Assinatura do transportador</Text>
                    <Text>Nome:</Text>
                    <Text>CPF:</Text>
                </View>

                <Text style={styles.footer} render={({ pageNumber, totalPages }) => (
                    `Página ${pageNumber} de ${totalPages}`
                )} fixed />
            </Page>
        </Document>
    );
};
