

"use client";

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Package, Users } from 'lucide-react';

export default function RegistrationPage() {
    return (
        <div className="w-full max-w-7xl mx-auto">
             <div className="text-center mb-10">
                <h1 className="text-4xl font-bold tracking-tight">Cadastros</h1>
                <p className="text-lg text-muted-foreground mt-2">Adicione, edite ou exclua os insumos, produtos base e outras entidades do sistema.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 justify-center">
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <Package className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Gerenciar insumos</CardTitle>
                        <CardDescription>Cadastre produtos, agrupe-os em "produtos base" e defina metas de estoque.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/registration/items" className="w-full">
                            <Button className="w-full text-lg py-6">
                                Acessar insumos <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
                <Card className="flex flex-col text-center items-center p-6 border-2 border-transparent hover:border-primary hover:shadow-xl transition-all duration-300">
                    <CardHeader className="p-0 items-center">
                        <div className="p-4 bg-primary/10 rounded-full mb-4">
                            <Users className="h-10 w-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Pessoas e empresas</CardTitle>
                        <CardDescription>Gerencie seus contatos, clientes e fornecedores em um único lugar.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-grow flex items-end justify-center w-full p-0 pt-6">
                        <Link href="/dashboard/registration/entities" className="w-full">
                            <Button className="w-full text-lg py-6">
                                Acessar cadastros <ArrowRight className="ml-2" />
                            </Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
