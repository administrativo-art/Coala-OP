import Link from "next/link";
import { ArrowRight, Construction } from "lucide-react";

export function RecruitmentComingSoon({ title }: { title: string }) {
  return (
    <main className="flex min-h-[calc(100vh-5rem)] items-center justify-center p-4">
      <section className="w-full max-w-md text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
          <Construction className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-[10px] font-black uppercase text-pink-600">Recrutamento</p>
        <h1 className="mt-1 text-xl font-black text-slate-950">{title}</h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Esta área está em construção e será liberada quando o fluxo estiver devidamente funcional.
        </p>
        <Link
          href="/dashboard/hr/recruitment/integration"
          className="mt-4 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-pink-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-pink-700"
        >
          Acessar Integração
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
