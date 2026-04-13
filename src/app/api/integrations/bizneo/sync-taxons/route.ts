import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://coala.bizneohr.com/api/v1';

export type BizneoTaxon = {
  id: number;
  name: string;
  parent_id: number | null;
  taxonomy_id: number;
};

export async function GET(_req: NextRequest) {
  try {
    const token = process.env.BIZNEO_TOKEN;
    if (!token) throw new Error('BIZNEO_TOKEN não configurado.');

    const all: BizneoTaxon[] = [];
    let page = 1;

    while (true) {
      const res = await fetch(
        `${BASE_URL}/taxons?token=${token}&page_size=100&page=${page}`,
        { headers: { Accept: 'application/json' } }
      );
      if (!res.ok) throw new Error(`Bizneo taxons: ${res.status}`);
      const data = await res.json();
      const taxons: BizneoTaxon[] = data.taxons ?? [];
      if (taxons.length === 0) break;
      all.push(...taxons);
      if (!data.pagination || page >= data.pagination.total_pages) break;
      page++;
    }

    return NextResponse.json({ success: true, taxons: all });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
