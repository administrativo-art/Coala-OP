import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/integrations/pdv-legal-admin';
import { dbAdmin } from '@/lib/firebase-admin';

const BASE_URL = 'https://api.tabletcloud.com.br';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') ?? new Date().toISOString().split('T')[0];
  const filialId = searchParams.get('filial') ?? '17343';
  const kioskId = searchParams.get('kiosk') ?? 'tirirical';

  try {
    // Dados da API PDV Legal
    const token = await getAccessToken();
    const res = await fetch(`${BASE_URL}/cupom/get/${date}/${date}/${filialId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'CodEmpresa': process.env.PDVLEGAL_COD_EMPRESA!,
        'Token': process.env.PDVLEGAL_TOKEN!,
      },
    });
    const raw = await res.json();
    const coupons = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    const first = coupons[0];
    const items = first ? (first.Itens || first.itens || []) : [];

    // Dados salvos no Firestore após último sync
    const dateUnder = date.replace(/-/g, '_');
    const reportDoc = await dbAdmin.collection('salesReports').doc(`sales_sync_${kioskId}_${dateUnder}`).get();
    const savedReport = reportDoc.exists ? reportDoc.data() : null;

    // Extrair timestamps de todos os cupons para diagnóstico
    const couponTimestamps = coupons.map((c: any) => ({
      dtrecebimento: c.dtrecebimento,
      dtabertura: c.dtabertura,
      dtmovimento: c.dtmovimento,
      iscancelado: c.iscancelado,
    }));

    return NextResponse.json({
      date,
      api: {
        totalCoupons: coupons.length,
        all_timestamps: couponTimestamps,
      },
      firestore: {
        exists: reportDoc.exists,
        hourlySales: savedReport?.hourlySales ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
