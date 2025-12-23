
// src/lib/pdf-generator.ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { type ProductSimulation, type ProductSimulationItem } from '@/types';
import { type BaseProduct } from '@/types';
import { convertValue } from './conversion';

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// Helper encapsulado
const setBold = (doc: jsPDF) => {
   doc.setFont('helvetica', 'bold'); 
};

export async function generateFichaTecnicaCompletaPdf(
  sim: ProductSimulation, 
  data: {
    simulationItems: ProductSimulationItem[],
    baseProducts: BaseProduct[]
  }
) {
    const doc = new jsPDF();
    const pageMargin = 14;
    const pageContentWidth = doc.internal.pageSize.getWidth() - 2 * pageMargin;
    let yPos = 15;

    const snap = (n: number) => Math.round(n * 100) / 100;

    const addSectionTitle = (title: string, currentY: number) => {
        if (currentY > 260) { doc.addPage(); currentY = 15; }
        doc.setFontSize(12);
        setBold(doc);
        doc.setTextColor(0);
        doc.text(title, pageMargin, currentY);
        doc.setFont('helvetica', 'normal');
        return currentY + 8;
    };

    const roundedRect = (x: number, y: number, w: number, h: number, r = 3, style: 'S'|'F'|'DF' = 'S') => {
        (doc as any).roundedRect(x, y, w, h, r, r, style);
    };

    const ensureSpace = (needed: number) => {
        if (yPos + needed > 275) { doc.addPage(); yPos = 15; }
    };

    const measureCardH = (value: string, w: number) => {
      doc.setFontSize(12); setBold(doc);
      const lines = doc.splitTextToSize(value || '—', w - 10);
      const h = (doc.getTextDimensions(lines as any).h || 0);
      return Math.max(18, 12 + h);
    };
    
    const drawInfoCard = (x: number, y: number, w: number, h: number, label: string, value: string, opts?: { highlight?: boolean }) => {
      doc.setDrawColor(226);
      if (opts?.highlight) doc.setFillColor(254, 249, 195);
      else doc.setFillColor(255, 255, 255);
      roundedRect(x, y, w, h, 1.8, 'DF');
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont('helvetica', 'normal');
      doc.text(label, x + 5, y + 7);
      doc.setFontSize(12);
      doc.setTextColor(17, 24, 39);
      setBold(doc);
      const maxTextWidth = w - 10;
      const lines = doc.splitTextToSize(value || '—', maxTextWidth);
      doc.text(lines as any, x + 5, y + 14);
    };

    const measureStepTextH = (txt: string, maxW: number) => {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(txt, maxW);
        return { lines, h: doc.getTextDimensions(lines as any).h || 4 };
    };
    
    const hasImage = sim.ppo?.referenceImageUrl;
    let textX = pageMargin;
    let headerStartY = yPos;
    
    if (hasImage) {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = sim.ppo!.referenceImageUrl!;
            await new Promise(resolve => { img.onload = resolve; img.onerror = () => resolve(null); });

            if (img.width > 0) {
                const box = 40;
                const aspect = img.width / img.height;
                let imgW = box;
                let imgH = box / aspect;
                if (imgH > box) { imgH = box; imgW = box * aspect; }
                
                yPos = headerStartY + imgH + 10;

                doc.addImage(img, 'JPEG', pageMargin, headerStartY, imgW, imgH);
                textX = pageMargin + imgW + 10;

                const titleY = headerStartY + (imgH / 2) - 3;
                doc.setFontSize(18); setBold(doc); doc.setTextColor(0);
                doc.text(sim.name, textX, titleY);
                doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
                doc.text(`SKU: ${sim.ppo?.sku || 'N/A'}`, textX, titleY + 6);
            }
        } catch { yPos += 25; }
    } else {
        doc.setFontSize(18); setBold(doc); doc.setTextColor(0);
        doc.text(sim.name, textX, yPos + 7);
        doc.setFontSize(9); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
        doc.text(`SKU: ${sim.ppo?.sku || 'N/A'}`, textX, yPos + 13);
        yPos += 25;
    }

    const infoItems: Array<{label: string; value: string}> = [
        { label: 'Preço de Venda', value: formatCurrency(sim.salePrice) },
        { label: 'Markup', value: `${sim.markup.toFixed(2)}x` },
        { label: 'Custo Bruto', value: formatCurrency(sim.grossCost) },
        { label: 'NCM', value: sim.ppo?.ncm || '—' },
        { label: 'Lucro Bruto', value: `${formatCurrency(sim.profitValue)} (${sim.profitPercentage.toFixed(2)}%)` },
        { label: 'CEST', value: sim.ppo?.cest || '—' },
        { label: 'CFOP', value: sim.ppo?.cfop || '—' },
    ];
    
    const padX_info = 8;
    const padTop_info = 10;
    const titleH_info = 10;
    const titleGap_info = 4;
    const rowGap_info = 6;
    
    const gridTopY_info = yPos + padTop_info + titleH_info + titleGap_info;
    const twoCols = (padX: number, gap: number) => {
        const SAFE = 0.6;
        const innerLeft  = pageMargin + padX + SAFE;
        const innerRight = pageMargin + pageContentWidth - padX - SAFE;
        let colW = (innerRight - innerLeft - gap) / 2;
        colW = Math.floor(colW * 100) / 100;
        const xLeft  = Math.floor(innerLeft * 100) / 100;
        const xRight = Math.floor((innerRight - colW) * 100) / 100;
        return { colW, xLeft, xRight };
    };
    const g_info = twoCols(padX_info, 8);
    
    const rowHeights_info = [];
    for (let i = 0; i < infoItems.length; i += 2) {
        const hL = measureCardH(infoItems[i]?.value || '', g_info.colW);
        const hR = infoItems[i + 1] ? measureCardH(infoItems[i + 1]?.value || '', g_info.colW) : 0;
        rowHeights_info.push(Math.max(hL, hR));
    }
    
    const totalGridHeight_info = rowHeights_info.reduce((sum, h) => sum + h, 0) + Math.max(0, rowHeights_info.length - 1) * rowGap_info;
    const boxH_info = padTop_info + titleH_info + titleGap_info + totalGridHeight_info + 10;

    ensureSpace(boxH_info + 8);
    doc.setFillColor(248, 250, 252); doc.setDrawColor(226);
    roundedRect(pageMargin, yPos, pageContentWidth, boxH_info, 4, 'DF');
    doc.setFontSize(11); setBold(doc); doc.setTextColor(39, 51, 68);
    doc.text('Informações de Venda e Fiscais', pageMargin + padX_info, yPos + padTop_info + 3);

    let gridY_info = gridTopY_info;
    let idx_info = 0;
    for (const hRow of rowHeights_info) {
        const xLeft = snap(g_info.xLeft);
        const xRight = snap(g_info.xRight);
        if (idx_info < infoItems.length) drawInfoCard(xLeft, gridY_info, g_info.colW, hRow, infoItems[idx_info].label, infoItems[idx_info++].value);
        if (idx_info < infoItems.length) drawInfoCard(xRight, gridY_info, g_info.colW, hRow, infoItems[idx_info].label, infoItems[idx_info++].value);
        gridY_info += hRow + rowGap_info;
    }
    yPos += boxH_info + 8;

    const ingredients = data.simulationItems
        .filter(item => item.simulationId === sim.id)
        .map(item => {
            const baseProduct = data.baseProducts.find(bp => bp.id === item.baseProductId);
            if (!baseProduct) return null;
            const costPerUnit = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
            const qty = item.quantity;
            let cost = 0;
            try {
                const valueInBase = convertValue(1, item.overrideUnit || baseProduct.unit, baseProduct.unit, baseProduct.category);
                cost = qty * (costPerUnit * valueInBase);
            } catch { /* ignore error */ }
    
            const impact = sim.totalCmv > 0 ? (cost / sim.totalCmv) * 100 : 0;
            return { name: baseProduct.name, qtyStr: `${qty} ${item.overrideUnit || baseProduct.unit}`, cpuStr: formatCurrency(costPerUnit), impact, cost };
        })
        .filter(Boolean)
        .sort((a, b) => b!.cost - a!.cost)
        .map(row => [row!.name, row!.qtyStr, row!.cpuStr, `${row!.impact.toFixed(1)}%`, formatCurrency(row!.cost)]);

    if (ingredients.length > 0) {
        yPos = addSectionTitle('Composição (CMV)', yPos);
        autoTable(doc, { startY: yPos, head: [['Insumo', 'Quantidade', 'Custo/unid.', 'Impacto', 'Custo Total']], body: ingredients, theme: 'striped', headStyles: { fillColor: [39, 51, 68], textColor: 255 }, styles: { fontSize: 10, fillColor: [255,255,255] }, alternateRowStyles: { fillColor: [246,248,250] } });
        yPos = (doc as any).lastAutoTable.finalY + 10;
    }

    if (sim.ppo?.assemblyInstructions && sim.ppo.assemblyInstructions.length > 0) {
        yPos = addSectionTitle('Modo de Montagem', yPos);
        let blockY = yPos;
    
        const phaseTitleH = 12;
        const lineColor = 226;
    
        for (const fase of sim.ppo.assemblyInstructions) {
            ensureSpace(phaseTitleH + 6);
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226);
            (doc as any).roundedRect(pageMargin, blockY, pageContentWidth, phaseTitleH, 3, 3, 'DF');
    
            doc.setFontSize(10);
            setBold(doc);
            doc.setTextColor(39, 51, 68);
            const _baseline = doc.getFontSize() * 0.32;
            const titleY = blockY + phaseTitleH / 2 + _baseline;
            doc.text(fase.name || 'Fase', pageMargin + 6, titleY, {
                align: 'justify',
                maxWidth: pageContentWidth - 12
            });
    
            blockY += phaseTitleH + 4;
    
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0);

            const SEP_INSET_L = pageMargin + 5;
            const SEP_INSET_R = doc.internal.pageSize.getWidth() - pageMargin - 5;
            const PAD_TOP = 6;
            const PAD_BOTTOM = 6;
            const textStartX = pageMargin + 6;
            const maxTextW = pageContentWidth - 12;

            for (let i = 0; i < fase.etapas.length; i++) {
                const etapa = fase.etapas[i];

                if (i > 0) {
                    doc.setDrawColor(226);
                    doc.setLineDashPattern([1], 0);
                    doc.line(SEP_INSET_L, blockY, SEP_INSET_R, blockY);
                    doc.setLineDashPattern([], 0);
                }

                const qty = (etapa.quantity ?? (etapa as any).qty ?? (etapa as any).quantidade ?? (etapa as any).amount ?? (etapa as any).medida ?? (etapa as any).qtd) as number | string | undefined;
                const unit = (etapa.unit ?? (etapa as any).unidade ?? (etapa as any).units ?? (etapa as any).sigla) as string | undefined;
                
                let measureStr = '';
                if (qty !== undefined && qty !== null && `${qty}`.trim() !== '') {
                  measureStr = `${qty}${unit ? ` ${unit}` : ''}`;
                }
          
                const coreText = (etapa.text || '').trim();
                const stepLabel = measureStr ? `${i + 1}. ${coreText} (${measureStr})` : `${i + 1}. ${coreText}`;
                
                doc.setFontSize(10);
                const lines = doc.splitTextToSize(stepLabel, maxTextW);
                const textH = doc.getTextDimensions(lines as any).h || 4;

                const rowH = PAD_TOP + textH + PAD_BOTTOM;
                ensureSpace(rowH + 1);

                const textY = blockY + PAD_TOP + (rowH - PAD_TOP - PAD_BOTTOM - textH) / 2 + textH * 0.32;

                doc.text(lines as any, textStartX, textY, {
                    align: 'justify',
                    maxWidth: maxTextW
                });

                blockY += rowH;
                doc.setDrawColor(226);
                doc.setLineDashPattern([1], 0);
                doc.line(SEP_INSET_L, blockY, SEP_INSET_R, blockY);
                doc.setLineDashPattern([], 0);

                const note = ((etapa as any).note || (etapa as any).obs || (etapa as any).observacao || '').trim();
                if (note) {
                    const nLines = doc.splitTextToSize(note, pageContentWidth - 10);
                    const nH = doc.getTextDimensions(nLines as any).h || 4;
                    ensureSpace(nH + 3);
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'italic');
                    doc.setTextColor(100);
                    doc.text(nLines as any, pageMargin + 6, blockY + 3);
                    blockY += nH + 3;
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(0);
                }
            }
            blockY += 2;
        }
        yPos = blockY;
    }

    if (sim.ppo?.assemblyVideoUrl) {
        const boxH = 24;
        ensureSpace(boxH + 4);
        doc.setFillColor(230, 240, 250); doc.setDrawColor(200);
        roundedRect(pageMargin, yPos, pageContentWidth, boxH, 3, 'DF');
        doc.setFontSize(11); setBold(doc); doc.setTextColor(39, 51, 68);
        doc.text('Vídeo de montagem', pageMargin + 6, yPos + 9);
        const linkLabel = 'Abrir vídeo';
        const linkY = yPos + 16;
        doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 238);
        doc.text(linkLabel, pageMargin + 6, linkY);
        const labelW = doc.getTextWidth(linkLabel);
        doc.link(pageMargin + 6, linkY - 4, labelW, 6, { url: sim.ppo.assemblyVideoUrl });
        doc.setTextColor(0);
        yPos += boxH + 6;
    }

    const detalhesBrutos = [
        sim.ppo?.preparationTime ? { label: 'Tempo de Preparo', value: `${sim.ppo.preparationTime} seg` } : null,
        sim.ppo?.portionWeight ? { label: 'Peso da Porção', value: `${sim.ppo.portionWeight}g (±${sim.ppo.portionTolerance || 0}g)` } : null,
        (sim.ppo?.qualityStandard?.length ?? 0 > 0) ? { label: 'Padrões de Qualidade', value: sim.ppo!.qualityStandard!.map(q => q.text).join('\\n') } : null,
        sim.ppo?.allergens?.length ? { label: 'Alergênicos', value: sim.ppo.allergens.map(a => a.text).join(', '), highlight: true } : null,
    ];
    const detalhes = detalhesBrutos.filter(Boolean).filter(d => d && typeof d.value === 'string' && !/^https?:/i.test(d.value)) as Array<{label: string; value: string; highlight?: boolean}>;

    if (detalhes.length > 0) {
        const padX2 = 8;
        const padTop2 = 10;
        const titleH2 = 10;
        const titleGap2 = 4;
        const rowGap2 = 6;
        const gridTopY2 = yPos + padTop2 + titleH2 + titleGap2;

        const g2 = twoCols(padX2, 8);
        
        const rowHeights2: number[] = [];
        for (let i = 0; i < detalhes.length; i += 2) {
            const hL = measureCardH(detalhes[i]?.value || '', g2.colW);
            const hR = detalhes[i + 1] ? measureCardH(detalhes[i + 1]?.value || '', g2.colW) : 0;
            rowHeights2.push(Math.max(hL, hR));
        }
        
        const totalGridHeight2 = rowHeights2.reduce((sum, h) => sum + h, 0) + Math.max(0, rowHeights2.length - 1) * rowGap2;
        const innerH2 = padTop2 + titleH2 + titleGap2 + totalGridHeight2 + 10;

        ensureSpace(innerH2 + 4);
        doc.setFillColor(248, 250, 252); doc.setDrawColor(226);
        roundedRect(pageMargin, yPos, pageContentWidth, innerH2, 4, 'DF');
        doc.setFontSize(11); setBold(doc); doc.setTextColor(39, 51, 68);
        doc.text('Detalhes Adicionais', pageMargin + padX2, yPos + padTop2);

        let gy = gridTopY2;
        let di = 0;
        for (const hRow of rowHeights2) {
            const xL = snap(g2.xLeft);
            const xR = snap(g2.xRight);
            if (di < detalhes.length) { const it = detalhes[di++]; drawInfoCard(xL, gy, g2.colW, hRow, it.label, it.value, { highlight: it.highlight }); }
            if (di < detalhes.length) { const it = detalhes[di++]; drawInfoCard(xR, gy, g2.colW, hRow, it.label, it.value, { highlight: it.highlight }); }
            gy += hRow + rowGap2;
        }
        yPos += innerH2 + 6;
    }

    const pages = (doc as any).getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFontSize(8); doc.setTextColor(100);
        const footer = `${sim.name} · pág. ${p}/${pages} · ${new Date().toLocaleDateString('pt-BR')}`;
        doc.text(footer, pageMargin, doc.internal.pageSize.getHeight() - 6);
    }

    doc.save(`ficha_tecnica_${sim.name.replace(/ /g, '_')}.pdf`);
}

    