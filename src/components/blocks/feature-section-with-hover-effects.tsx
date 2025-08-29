
"use client";
import { cn } from "@/lib/utils";
import {
  IconClipboardCheck,
  IconReceipt2,
  IconChartBar,
  IconCalculator,
  IconTruck,
  IconUsers,
  IconCalendarStats,
  IconBellRinging,
} from "@tabler/icons-react";

export function FeaturesSectionWithHoverEffects() {
  const features = [
    {
      title: "Controle de Estoque",
      description:
        "Gerencie lotes, vencimentos, transferências e adicione novos insumos com facilidade.",
      icon: <IconClipboardCheck />,
    },
    {
      title: "Análise de Custo e Preço",
      description:
        "Calcule o CMV, simule preços de venda e analise a lucratividade de cada produto.",
      icon: <IconCalculator />,
    },
    {
      title: "Gestão de Compras",
      description:
        "Crie cotações de preços, compare fornecedores e efetive compras de forma centralizada.",
      icon: <IconReceipt2 />,
    },
    {
      title: "Controle de Vencimentos",
      description:
        "Receba alertas sobre produtos próximos do vencimento e evite perdas.",
      icon: <IconBellRinging />,
    },
    {
      title: "Análise de Reposição",
      description: "Compare o estoque atual com as metas e saiba exatamente o que e quanto repor.",
      icon: <IconChartBar />,
    },
    {
      title: "Gestão de Avarias",
      description:
        "Controle o processo de devolução e bonificação de insumos com fornecedores.",
      icon: <IconTruck />,
    },
     {
      title: "Escala de Trabalho",
      description:
        "Organize os turnos e folgas da sua equipe de forma visual e intuitiva.",
      icon: <IconCalendarStats />,
    },
    {
      title: "Perfis e Permissões",
      description: "Defina perfis de acesso detalhados para cada colaborador do seu time.",
      icon: <IconUsers />,
    },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4  relative z-10 py-10 max-w-7xl mx-auto">
      {features.map((feature, index) => (
        <Feature key={feature.title} {...feature} index={index} />
      ))}
    </div>
  );
}

const Feature = ({
  title,
  description,
  icon,
  index,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  index: number;
}) => {
  return (
    <div
      className={cn(
        "flex flex-col lg:border-r  py-10 relative group/feature dark:border-neutral-800",
        (index === 0 || index === 4) && "lg:border-l dark:border-neutral-800",
        index < 4 && "lg:border-b dark:border-neutral-800"
      )}
    >
      {index < 4 && (
        <div className="opacity-0 group-hover/feature:opacity-100 transition duration-200 absolute inset-0 h-full w-full bg-gradient-to-t from-neutral-100 dark:from-neutral-800 to-transparent pointer-events-none" />
      )}
      {index >= 4 && (
        <div className="opacity-0 group-hover/feature:opacity-100 transition duration-200 absolute inset-0 h-full w-full bg-gradient-to-b from-neutral-100 dark:from-neutral-800 to-transparent pointer-events-none" />
      )}
      <div className="mb-4 relative z-10 px-10 text-neutral-600 dark:text-neutral-400">
        {icon}
      </div>
      <div className="text-lg font-bold mb-2 relative z-10 px-10">
        <div className="absolute left-0 inset-y-0 h-6 group-hover/feature:h-8 w-1 rounded-tr-full rounded-br-full bg-neutral-300 dark:bg-neutral-700 group-hover/feature:bg-blue-500 transition-all duration-200 origin-center" />
        <span className="group-hover/feature:translate-x-2 transition duration-200 inline-block text-neutral-800 dark:text-neutral-100">
          {title}
        </span>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300 max-w-xs relative z-10 px-10">
        {description}
      </p>
    </div>
  );
};
