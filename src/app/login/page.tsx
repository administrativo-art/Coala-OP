
"use client"

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

const loginSchema = z.object({
  username: z.string().min(1, 'O nome de usuário é obrigatório.'),
  password: z.string().min(1, 'A senha é obrigatória.'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, loading: authLoading } = useAuth();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, authLoading, router]);

  const onSubmit = async (values: LoginFormValues) => {
    const success = await login(values.username, values.password);
    if (success) {
      router.push('/dashboard');
    } else {
      form.setError("password", { message: "Usuário ou senha inválidos."})
      form.setValue('password', '');
    }
  };

  if (authLoading || isAuthenticated) {
    return <div className="flex h-screen items-center justify-center">Carregando...</div>;
  }
  
  return (
    <div style={{ backgroundImage: "url('/login-background.svg')", backgroundSize: 'cover', backgroundPosition: 'center' }}
         className="flex min-h-screen flex-col items-center justify-center p-4">
      
      <div className="w-full max-w-sm rounded-3xl bg-white/20 backdrop-blur-xl border-2 border-white/30 shadow-xl p-8 flex flex-col items-center">
        <div className="text-center font-logo select-none mb-8">
            <div className="text-6xl font-bold text-primary">coala</div>
            <div className="text-5xl font-bold text-accent -mt-4 pl-6">shakes</div>
        </div>

        <h2 className="text-center text-2xl font-bold text-white tracking-wider mb-6">BEM VINDO</h2>
        
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 w-full">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <Label htmlFor="username-input" className="sr-only">Usuário</Label>
                    <FormControl>
                        <Input
                            id="username-input"
                            placeholder="Usuário"
                            className="h-12 rounded-full bg-accent/80 border-none text-white placeholder:text-white/80 focus-visible:ring-4 focus-visible:ring-accent/40 text-center"
                            {...field}
                        />
                    </FormControl>
                    <FormMessage className="text-primary/90 text-center" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <Label htmlFor="password-input" className="sr-only">Senha</Label>
                    <FormControl>
                       <Input
                            id="password-input"
                            type="password"
                            placeholder="Senha"
                            className="h-12 rounded-full bg-accent/80 border-none text-white placeholder:text-white/80 focus-visible:ring-4 focus-visible:ring-accent/40 text-center"
                            {...field}
                        />
                    </FormControl>
                    <FormMessage className="text-primary/90 text-center" />
                  </FormItem>
                )}
              />
              <div className="pt-2">
                <Button
                    type="submit"
                    className="h-12 w-full rounded-full bg-gradient-to-r from-primary to-[#FF5A8A] text-white text-lg shadow-lg transition-transform duration-200 hover:-translate-y-0.5"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    Entrar
                </Button>
              </div>
            </form>
          </Form>

          <div className="text-center mt-6">
            <a href="#" className="text-sm text-white/80 hover:text-white hover:underline">
              Trocar minha senha
            </a>
          </div>
      </div>
    </div>
  );
}
