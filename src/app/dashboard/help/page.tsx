
"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LifeBuoy, Package, Users, LayoutDashboard, ClipboardCheck, BarChart3, ShoppingCart, ShieldAlert, Truck, Users2, ListPlus, DollarSign } from 'lucide-react';
import Image from 'next/image';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const helpTopics = [
    {
        icon: LayoutDashboard,
        title: "Dashboard principal",
        content: [
            {
                question: "O que são os cards de KPI no topo?",
                answer: "Os cards de 'Vencendo em 7 dias' e 'Produtos Vencidos' são alertas rápidos sobre o estado do seu estoque. Eles mostram a contagem de lotes que exigem atenção imediata. Clicar em qualquer um deles leva você diretamente para a tela de Controle de Estoque com os filtros apropriados já aplicados."
            },
            {
                question: "Como funciona a 'Escala de Hoje'?",
                answer: "Esta seção mostra quem está escalado para trabalhar em cada quiosque no dia atual. Se você tiver permissão, pode clicar no ícone de edição ao lado do nome do quiosque para alterar a escala daquele dia diretamente do dashboard."
            },
            {
                question: "O que é o gráfico de 'Consumo Médio Mensal'?",
                answer: "Este gráfico exibe o consumo médio de cada insumo base, ajudando a entender as tendências e a planejar compras futuras. Você pode filtrar por quiosque e selecionar quais produtos exibir. O card é recolhível para otimizar seu espaço de visualização."
            }
        ]
    },
    {
        icon: ListPlus,
        title: "Cadastros",
        content: [
            {
                question: "Qual a diferença entre 'Insumo' e 'Produto Base'?",
                answer: "O 'Insumo' é o item físico que você compra (ex: 'Leite Condensado Moça - Lata 395g'). O 'Produto Base' é um agrupador (ex: 'Leite Condensado'). Você agrupa vários insumos (de diferentes marcas e tamanhos) sob um único Produto Base. O estoque mínimo e a análise de consumo são sempre feitos com base no Produto Base."
            },
            {
                question: "Como cadastrar um novo insumo?",
                answer: "Vá para 'Cadastros > Gerenciar Insumos'. Clique em 'Adicionar novo insumo'. Preencha os detalhes como nome, marca, tamanho da embalagem e unidade. Se desejar, pode vincular este insumo a um 'Produto Base' já existente para facilitar a gestão."
            }
        ]
    },
    {
        icon: ClipboardCheck,
        title: "Gestão de estoque",
        content: [
            {
                question: "Como adicionar um novo lote ao estoque?",
                answer: "Na tela de 'Controle de Estoque', clique em 'Adicionar lote'. Selecione o insumo, preencha o número do lote, data de validade, quantidade e quiosque. Este lote passará a ser monitorado pelo sistema."
            },
            {
                question: "Como fazer uma transferência entre quiosques?",
                answer: "No card do lote que deseja mover, clique no ícone de caminhão (Mover). Um modal aparecerá para você selecionar o quiosque de destino e a quantidade a ser transferida. Isso gerará uma atividade de reposição que precisa ser despachada na origem e recebida no destino."
            },
            {
                question: "Para que serve a 'Contagem de Estoque'?",
                answer: "Use esta funcionalidade para fazer contagens parciais ou completas do seu estoque. Selecione um quiosque, e o sistema listará todos os lotes presentes. Você pode então inserir a quantidade contada. Se houver divergência, a contagem será enviada para aprovação do administrador, que poderá ajustar o estoque no sistema."
            },
            {
                question: "Um insumo não está na lista durante a contagem. O que eu faço?",
                answer: "Se você encontrar um item no estoque físico que não está no sistema, clique no botão 'Solicitar Cadastro de Insumo' na tela de contagem. Preencha os detalhes do produto encontrado. A solicitação será enviada para um administrador aprovar e cadastrar o novo insumo."
            }
        ]
    },
    {
        icon: BarChart3,
        title: "Análise de estoque",
        content: [
            {
                question: "Como funciona a 'Análise de Reposição'?",
                answer: "Esta tela compara o estoque atual de um quiosque com a meta de estoque mínimo definida para cada Produto Base. Ela mostra o que precisa ser reposto e sugere quais lotes da Matriz podem ser usados para a reposição, priorizando os que vencem primeiro."
            },
            {
                question: "O que é a 'Avaliação Financeira'?",
                answer: "Esta funcionalidade calcula o valor monetário total do seu estoque com base no último preço de compra efetivado para cada Produto Base. É uma ferramenta essencial para o controle financeiro e contábil."
            }
        ]
    },
    {
        icon: DollarSign,
        title: "Custo e preço",
        isTable: true,
        content: [
            { secao: 'Fórmulas', descricao: 'Cálculo de Custo de Mercadoria Vendida (CMV) e Lucro.', localizacao: 'Colunas de resultado', exemplo: 'CMV + (CMV * % op.)' },
            { secao: 'Simbologia', descricao: 'Unidades de medida padrão utilizadas nos cálculos.', localizacao: 'Cadastro de insumos', exemplo: 'g, ml, un' },
            { secao: 'Cores', descricao: 'Formatação condicional baseada na lucratividade.', localizacao: 'Coluna "Lucro %"', exemplo: '≥ 50% → Verde' },
            { secao: 'Meta de Lucro', descricao: 'Sugestão de preço com base na margem de lucro desejada.', localizacao: 'Análise com IA', exemplo: 'Sugerir com 55%' },
            { secao: 'Atualização', descricao: 'Quando revisar os custos para manter a precisão.', localizacao: 'Módulo de compras', exemplo: 'Efetivar novos preços' },
        ]
    },
    {
        icon: ShieldAlert,
        title: "Gestão de avarias",
        content: [
            {
                question: "Quando devo abrir um chamado de avaria?",
                answer: "Sempre que um produto apresentar algum problema que impeça seu uso (vencido, embalagem danificada, etc.) e você precisar negociar uma devolução ou bonificação com o fornecedor. O sistema ajuda a rastrear esse processo do início ao fim."
            },
            {
                question: "O que é o checklist dentro de um chamado?",
                answer: "O checklist é um guia de tarefas para garantir que todo o processo seja seguido corretamente. Ele muda conforme o status do chamado (ex: 'Em andamento' exige filmar o produto, enquanto 'Finalizado' exige o preenchimento dos detalhes do resultado)."
            }
        ]
    }
];

export default function HelpPage() {
    return (
        <div className="w-full max-w-5xl mx-auto">
            <div className="flex flex-col items-center text-center mb-10">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                    <LifeBuoy className="h-12 w-12 text-primary" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight">Central de ajuda</h1>
                <p className="text-lg text-muted-foreground mt-2">
                    Encontre respostas para suas dúvidas sobre o funcionamento do sistema.
                </p>
            </div>

            <Accordion type="single" collapsible className="w-full">
                {helpTopics.map((topic) => {
                    const Icon = topic.icon;
                    return (
                        <AccordionItem value={topic.title} key={topic.title}>
                            <AccordionTrigger className="text-xl font-semibold">
                                <div className="flex items-center gap-3">
                                    <Icon className="h-6 w-6" />
                                    {topic.title}
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="pt-2 pb-4 space-y-4">
                                {topic.isTable ? (
                                     <Card>
                                        <CardContent className="p-0">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead className="w-[120px]">Seção</TableHead>
                                                        <TableHead>Descrição</TableHead>
                                                        <TableHead>Exemplo</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {(topic.content as {secao: string; descricao: string; localizacao: string; exemplo: string}[]).map((item) => (
                                                        <TableRow key={item.secao}>
                                                            <TableCell className="font-semibold">{item.secao}</TableCell>
                                                            <TableCell>
                                                                <p>{item.descricao}</p>
                                                                <p className="text-xs text-muted-foreground">Em: {item.localizacao}</p>
                                                            </TableCell>
                                                            <TableCell>
                                                                <code className="bg-muted text-foreground font-mono p-1 rounded-sm text-xs">{item.exemplo}</code>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    (topic.content as {question: string; answer: string}[]).map((item, index) => (
                                        <Card key={index}>
                                            <CardHeader>
                                                <CardTitle className="text-lg">{item.question}</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <p className="text-muted-foreground">{item.answer}</p>
                                            </CardContent>
                                        </Card>
                                    ))
                                )}
                            </AccordionContent>
                        </AccordionItem>
                    );
                })}
            </Accordion>
        </div>
    );
}
