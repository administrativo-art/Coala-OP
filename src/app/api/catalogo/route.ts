import { type NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebase-admin';
import { requireUser } from '@/lib/auth-server';
import { canViewTechnicalSheets } from '@/lib/commercial-permissions';
import { logAction } from '@/lib/log-action';
import { type ProductSimulation, type ProductSimulationItem, type BaseProduct, type SimulationCategory } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getClientIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  );
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const userContext = await requireUser(request).catch(() => null);
    if (!userContext) return jsonError('Não autorizado.', 401);
    if (!canViewTechnicalSheets(userContext.permissions)) {
      return jsonError('Sem permissão para consultar fichas técnicas.', 403);
    }

    const [simSnap, itemsSnap, baseProductsSnap, catSnap] = await Promise.all([
      dbAdmin.collection('productSimulations').get(),
      dbAdmin.collection('productSimulationItems').get(),
      dbAdmin.collection('baseProducts').get(),
      dbAdmin.collection('productSimulationCategories').get(),
    ]);

    const lineMap = new Map<string, SimulationCategory>();
    catSnap.docs.forEach(doc => {
      const cat = { id: doc.id, ...doc.data() } as SimulationCategory;
      if (cat.type === 'line') lineMap.set(cat.id, cat);
    });

    const lines = Array.from(lineMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR'),
    );

    const items = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ProductSimulationItem);
    const baseProductMap = new Map(
      baseProductsSnap.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() } as BaseProduct]),
    );

    const products = simSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }) as ProductSimulation)
      .filter(sim => !sim.isArchived)
      .map(sim => ({
        id: sim.id,
        name: sim.name,
        lineId: sim.lineId ?? null,
        imageUrl: sim.ppo?.referenceImageUrl ?? null,
        preparationTime: sim.ppo?.preparationTime ?? null,
        portionWeight: sim.ppo?.portionWeight ?? null,
        portionTolerance: sim.ppo?.portionTolerance ?? null,
        assemblyInstructions: sim.ppo?.assemblyInstructions ?? [],
        qualityStandard: sim.ppo?.qualityStandard ?? [],
        allergens: sim.ppo?.allergens ?? [],
        assemblyVideoUrl: sim.ppo?.assemblyVideoUrl ?? null,
        sku: sim.ppo?.sku ?? (sim as any).sku ?? null,
        ingredients: items
          .filter(item => item.simulationId === sim.id)
          .map(item => {
            const bp = baseProductMap.get(item.baseProductId);
            return {
              name: bp?.name ?? 'Insumo não encontrado',
              quantity: item.quantity,
              unit: item.overrideUnit ?? bp?.unit ?? 'un',
            };
          }),
      }))
      .sort((a, b) => {
        const numA = a.sku !== null ? Number(a.sku) : Infinity;
        const numB = b.sku !== null ? Number(b.sku) : Infinity;
        if (numA !== numB) return numA - numB;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

    await logAction({
      workspace_id: userContext.workspace_id,
      user_id: userContext.userDoc.id,
      username: userContext.userDoc.username,
      module: 'catalogo',
      action: 'technical_catalog_viewed',
      metadata: {
        route: '/catalogo',
        product_count: products.length,
        line_count: lines.length,
        user_agent: request.headers.get('user-agent')?.slice(0, 240) ?? null,
      },
      ip_address: getClientIp(request),
      ttl_days: 365,
    }).catch((error) => {
      console.error('Catalogo access log error:', error);
    });

    return NextResponse.json({ lines, products });
  } catch (error) {
    console.error('Catalogo API error:', error);
    return NextResponse.json({ error: 'Falha ao carregar dados' }, { status: 500 });
  }
}
