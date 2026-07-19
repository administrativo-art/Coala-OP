import Link from "next/link";
import { Building2, ChevronRight, FileStack, Users } from "lucide-react";

const destinations = [
  {
    title: "Documentos da empresa",
    description: "Contratos, licenças, certidões e arquivos institucionais.",
    href: "/dashboard/documents/company",
    icon: Building2,
    tone: "bg-teal-50 text-teal-700",
  },
  {
    title: "Documentos dos colaboradores",
    description: "Pastas individuais, validações e histórico funcional.",
    href: "/dashboard/documents/collaborators",
    icon: Users,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    title: "Modelos",
    description: "Modelos de contratos, termos e documentos internos.",
    href: "/dashboard/documents/templates",
    icon: FileStack,
    tone: "bg-violet-50 text-violet-700",
  },
];

export default function DocumentsPage() {
  return (
    <div className="space-y-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Gestão documental</p>
        <h1 className="text-xl font-black text-slate-950">Documentos</h1>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        {destinations.map(({ title, description, href, icon: Icon, tone }) => (
          <Link
            key={href}
            href={href}
            className="group flex min-h-32 items-start gap-3 rounded-lg border bg-white p-4 shadow-sm transition hover:border-teal-200 hover:shadow-md"
          >
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-slate-900">{title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
            </span>
            <ChevronRight className="mt-2 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-700" />
          </Link>
        ))}
      </div>
    </div>
  );
}
