
"use client"

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const resetPasswordSchema = z.object({
  email: z.string().email('Por favor, insira um e-mail válido.'),
});

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  const onSubmit = async (values: ResetPasswordFormValues) => {
    setIsSubmitting(true);
    const success = await resetPassword(values.email);
    setIsSubmitting(false);

    if (success) {
      toast({
        title: "E-mail enviado!",
        description: "Verifique sua caixa de entrada para as instruções de redefinição de senha.",
      });
      router.push('/login');
    } else {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Não foi possível enviar o e-mail de redefinição. Verifique se o e-mail está correto.",
      });
    }
  };

  return (
    <div style={{ backgroundImage: "url('/login-background.svg')", backgroundSize: 'cover', backgroundPosition: 'center' }}
         className="flex min-h-screen flex-col items-center justify-center p-4">
      
      <div className="w-full max-w-sm rounded-3xl bg-white/20 backdrop-blur-xl border-2 border-white/30 shadow-2xl p-8 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
        <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-black/60" style={{textShadow: '0 1px 3px rgba(255,255,255,0.4)'}}>Redefinir senha</h1>
            <p className="text-sm text-black/50 mt-1">Insira seu e-mail para receber o link de redefinição.</p>
        </div>
        
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 w-full">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                     <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/50" />
                        <FormControl>
                            <Input
                                placeholder="Seu e-mail de cadastro"
                                className="h-12 rounded-full bg-accent/80 border-none text-white placeholder:text-white/80 focus-visible:ring-4 focus-visible:ring-accent/40 text-center px-12"
                                {...field}
                            />
                        </FormControl>
                    </div>
                    <FormMessage className="text-primary/90 text-center" />
                  </FormItem>
                )}
              />
              <div className="pt-4">
                <Button
                    type="submit"
                    className="h-12 w-full rounded-full bg-gradient-to-r from-primary to-[#FF5A8A] text-white text-lg shadow-lg transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-px"
                    disabled={isSubmitting}
                  >
                    {isSubmitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Enviar e-mail
                </Button>
              </div>
            </form>
          </Form>

          <div className="text-center mt-4">
            <Link href="/login" className="text-sm text-black/60 hover:text-black/80 transition-colors duration-200">
              Voltar para o login
            </Link>
          </div>
      </div>
    </div>
  );
}
