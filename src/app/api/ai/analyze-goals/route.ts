import { NextRequest, NextResponse } from "next/server";
import { analyzeGoals } from "@/ai/flows/analyze-goals-flow";
import { GoalsAnalysisInputSchema } from "@/ai/flows/goals-schemas";
import { verifyAuth } from "@/lib/verify-auth";
import { assertAiEnabled } from "@/ai/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  assertAiEnabled("analyze-goals");

  try {
    await verifyAuth(req);
  } catch {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  try {
    const json = await req.json();
    const input = GoalsAnalysisInputSchema.parse(json);

    // Call the existing flow function
    const analysisResult = await analyzeGoals(input);

    return NextResponse.json(analysisResult);
  } catch (err: any) {
    console.error("Goals AI Analysis API Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error during AI goals analysis." },
      { status: 500 }
    );
  }
}
