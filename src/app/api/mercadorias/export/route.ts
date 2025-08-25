
import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { type ProductSimulation, type ProductSimulationItem, type BaseProduct, type SimulationCategory } from '@/types';
import Papa from 'papaparse';

export async function GET() {
  try {
    // 1. Fetch all necessary data in parallel
    const [
      simulationsSnapshot,
      itemsSnapshot,
      baseProductsSnapshot,
      categoriesSnapshot
    ] = await Promise.all([
      getDocs(collection(db, 'productSimulations')),
      getDocs(collection(db, 'productSimulationItems')),
      getDocs(collection(db, 'baseProducts')),
      getDocs(collection(db, 'productSimulationCategories')),
    ]);

    // 2. Process and map data for efficient lookup
    const simulations = simulationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulation));
    const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductSimulationItem));
    const baseProductMap = new Map(baseProductsSnapshot.docs.map(doc => [doc.id, doc.data() as BaseProduct]));
    const categoryMap = new Map(categoriesSnapshot.docs.map(doc => [doc.id, doc.data() as SimulationCategory]));

    // 3. Combine the data into the desired CSV structure
    const csvData = simulations.map(sim => {
      const compositionItems = items
        .filter(item => item.simulationId === sim.id)
        .map(item => {
          const baseProduct = baseProductMap.get(item.baseProductId);
          if (!baseProduct) return null;

          const name = baseProduct.name;
          const quantity = item.quantity;
          const unit = item.overrideUnit || baseProduct.unit;
          
          return `${name}:${quantity}:${unit}`;
        })
        .filter((item): item is string => item !== null);

      const classificationNames = (sim.categoryIds || [])
        .map(id => categoryMap.get(id)?.name)
        .filter(Boolean);

      return {
        name: sim.name,
        ingredients: compositionItems.join('|'),
        classifications: classificationNames.join('|'),
      };
    });

    // 4. Convert to CSV string using PapaParse
    const csv = Papa.unparse(csvData, {
        header: true,
        quotes: true,
    });

    // 5. Return CSV as a downloadable file
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="mercadorias.csv"',
      },
    });

  } catch (error) {
    console.error("Error generating mercadorias CSV export:", error);
    return NextResponse.json({ error: 'Failed to generate CSV file' }, { status: 500 });
  }
}
