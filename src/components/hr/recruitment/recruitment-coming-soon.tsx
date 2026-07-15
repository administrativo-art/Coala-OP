import Link from "next/link";
import { ArrowRight, Construction } from "lucide-react";

export function RecruitmentComingSoon({ title }: { title: string }) {
  return (
    <main className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-10">
      <section className="w-full max-w-xl text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-pink-50 text-pink-600">
          <Construction className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="mt-5 text-xs font-black uppercase text-pink-600">Recrutamento</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{title}</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-500">
          Esta área está em construção e será liberada quando o fluxo estiver devidamente funcional.
        </p>
        <Link
          href="/dashboard/hr/recruitment/integration"
          className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-pink-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-pink-700"
        >
          Acessar Integração
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
