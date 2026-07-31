import { NextRequest, NextResponse } from 'next/server';
import { syncDayAdmin } from '@/lib/integrations/pdv-legal-admin';
import { dbAdmin } from '@/lib/firebase-admin';
import { resolvePdvFilialId } from '@/lib/kiosk-identifiers';
import { requireUser, type ServerUserContext } from '@/lib/auth-server';
import { filterUnitsByAccess } from '@/lib/unit-access';

/**
 * Endpoint para sincronização AUTÔNOMA do PDV Legal.
 * Segurança: Requer Header 'Authorization: Bearer <SYNC_SECRET>'
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get('date');
  const startStr = searchParams.get('start');
  const endStr = searchParams.get('end');
  const kioskId = searchParams.get('kiosk');

  // Validação de segurança: aceita secret server-to-server OU Firebase ID Token
  const authHeader = req.headers.get('Authorization');
  const syncSecret = process.env.PDV_SYNC_SECRET;
  const isSecretValid = syncSecret && authHeader === `Bearer ${syncSecret}`;
  let userContext: ServerUserContext | null = null;

  if (!isSecretValid) {
    try {
      userContext = await requireUser(req);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const canSync =
      userContext.isDefaultAdmin ||
      userContext.permissions.stock.analysis.consumption;
    if (!canSync) {
      return NextResponse.json(
        { success: false, error: 'Sem permissão para sincronizar vendas do PDV.' },
        { status: 403 },
      );
    }
  }

  try {
    // Busca quiosques configurados no Firestore
    const kiosksSnap = await dbAdmin.collection('kiosks').get();
    const allKiosks = kiosksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    
    // Mapeamento final: prioriza Firestore, depois fallback padrão da aplicação.
    let validKiosks = allKiosks.map(k => {
      const pdvId = resolvePdvFilialId(k);
      return pdvId ? { ...k, pdvFilialId: pdvId } : null;
    }).filter(Boolean) as any[];

    if (userContext) {
      validKiosks = filterUnitsByAccess(validKiosks, userContext.userDoc, {
        isDefaultAdmin: userContext.isDefaultAdmin,
      });
    }

    if (kioskId && !validKiosks.some((kiosk) => kiosk.id === kioskId)) {
      return NextResponse.json(
        { success: false, error: 'Quiosque não autorizado ou sem integração configurada.' },
        { status: 403 },
      );
    }

    const results: any[] = [];
    const errors: any[] = [];

    // Caso 1: Sincronizar um período (Retroativo)
    if (startStr && endStr) {
      // Garantir que as datas sejam tratadas como UTC para o loop
      let current = new Date(startStr + 'T12:00:00Z');
      const end = new Date(endStr + 'T12:00:00Z');
      if (Number.isNaN(current.getTime()) || Number.isNaN(end.getTime()) || current > end) {
        return NextResponse.json({ success: false, error: 'Período inválido.' }, { status: 400 });
      }
      const totalDays = Math.floor((end.getTime() - current.getTime()) / 86400000) + 1;
      if (totalDays > 370) {
        return NextResponse.json(
          { success: false, error: 'O período máximo para sincronização é de 370 dias.' },
          { status: 400 },
        );
      }

      while (current <= end) {
        const dayStr = current.toISOString().split('T')[0];
        const kiosksToSync = kioskId 
          ? validKiosks.filter(k => k.id === kioskId)
          : validKiosks;
        
        for (const kiosk of kiosksToSync) {
          try {
            console.log(`[Sync API] Sincronizando ${dayStr} para ${kiosk.id} (${kiosk.pdvFilialId})...`);
            const res = await syncDayAdmin(dayStr, kiosk.id, kiosk.pdvFilialId);
            results.push({ day: dayStr, kioskId: kiosk.id, ...res });
          } catch (e: any) {
            console.error(`[Sync API] Erro em ${dayStr} (${kiosk.id}):`, e.message);
            errors.push({ day: dayStr, kioskId: kiosk.id, error: e.message, code: e.code });
          }
        }
        current.setUTCDate(current.getUTCDate() + 1);
      }
    } 
    // Caso 2: Sincronizar um dia específico (ou "ontem")
    else {
      const targetDate = dateStr || new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const kiosksToSync = kioskId 
        ? validKiosks.filter(k => k.id === kioskId)
        : validKiosks;

      for (const kiosk of kiosksToSync) {
        try {
          const res = await syncDayAdmin(targetDate, kiosk.id, kiosk.pdvFilialId);
          results.push({ day: targetDate, kioskId: kiosk.id, ...res });
        } catch (e: any) {
          console.error(`[Sync API] Erro em ${targetDate} (${kiosk.id}):`, e.message);
          errors.push({ day: targetDate, kioskId: kiosk.id, error: e.message, code: e.code });
        }
      }
    }

    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      processed: results, 
      errors: errors.length > 0 ? errors : undefined 
    });

  } catch (error: any) {
    console.error('[Sync API] Fatal Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
