
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";

const features = {
  free: [
    "Até 3 usuários",
    "Conversão de medidas",
    "Controle de validade",
    "Gerenciamento de 1 quiosque",
    "Suporte via comunidade",
  ],
  pro: [
    "Até 15 usuários",
    "Todos os recursos do plano Grátis",
    "Análise de estoque com IA (PDF)",
    "Gerenciamento de múltiplos quiosques",
    "Perfis de permissão avançados",
    "Histórico de relatórios",
    "Suporte prioritário via e-mail",
  ],
  enterprise: [
    "Usuários ilimitados",
    "Todos os recursos do plano Pro",
    "Integrações personalizadas",
    "Gerente de conta dedicado",
    "Suporte 24/7 via telefone e chat",
    "Treinamento para a equipe",
  ]
}

export default function PricingPage() {
  return (
    <div className="w-full">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold font-headline">Planos e Cobrança</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Escolha o plano que melhor se adapta ao tamanho e às necessidades da sua operação. Cancele quando quiser.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {/* Plano Grátis */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-2xl">Grátis</CardTitle>
            <CardDescription>Para começar a organizar sua operação sem custo.</CardDescription>
            <div className="pt-4">
              <span className="text-4xl font-bold">R$ 0</span>
              <span className="text-muted-foreground">/mês</span>
            </div>
          </CardHeader>
          <CardContent className="flex-grow">
            <ul className="space-y-3">
              {features.free.map((feature, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" disabled>Seu plano atual</Button>
          </CardFooter>
        </Card>

        {/* Plano Pro */}
        <Card className="border-primary flex flex-col ring-2 ring-primary">
           <CardHeader>
            <CardTitle className="text-2xl">Pro</CardTitle>
            <CardDescription>Para equipes que precisam de automação e mais controle.</CardDescription>
            <div className="pt-4">
              <span className="text-4xl font-bold">R$ 99</span>
              <span className="text-muted-foreground">/mês</span>
            </div>
          </CardHeader>
          <CardContent className="flex-grow">
            <ul className="space-y-3">
              {features.pro.map((feature, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button className="w-full">Fazer Upgrade</Button>
          </CardFooter>
        </Card>

        {/* Plano Enterprise */}
        <Card className="flex flex-col">
           <CardHeader>
            <CardTitle className="text-2xl">Enterprise</CardTitle>
            <CardDescription>Soluções sob medida para grandes operações e franquias.</CardDescription>
            <div className="pt-4">
              <span className="text-4xl font-bold">Personalizado</span>
            </div>
          </CardHeader>
          <CardContent className="flex-grow">
            <ul className="space-y-3">
              {features.enterprise.map((feature, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">Entre em Contato</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
