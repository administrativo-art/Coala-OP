
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
      form.setValue('password', '');
    }
  };

  if (authLoading || isAuthenticated) {
    return <div className="flex h-screen items-center justify-center">Carregando...</div>;
  }
  
  return (
    <div style={{ backgroundImage: "url('/login-background.svg')", backgroundSize: 'cover', backgroundPosition: 'center' }}
         className="flex min-h-screen flex-col items-center justify-center p-4">
      
      <div className="w-full max-w-sm rounded-3xl bg-white/20 backdrop-blur-lg border border-white/30 shadow-xl p-8 space-y-6">
        <div className="text-center font-logo select-none">
            <div className="text-6xl font-bold text-primary">coala</div>
            <div className="text-5xl font-bold text-accent -mt-4 pl-6">shakes</div>
        </div>

        <h2 className="text-center text-2xl font-bold text-white">BEM VINDO</h2>
        
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                        <Input
                            placeholder="Usuário"
                            className="rounded-full bg-accent/80 border-none text-white placeholder:text-white/70 focus-visible:ring-white text-center"
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
                    <FormControl>
                       <Input
                            type="password"
                            placeholder="Senha"
                            className="rounded-full bg-accent/80 border-none text-white placeholder:text-white/70 focus-visible:ring-white text-center"
                            {...field}
                        />
                    </FormControl>
                    <FormMessage className="text-primary/90 text-center" />
                  </FormItem>
                )}
              />
              <Button
                  type="submit"
                  className="w-full rounded-full bg-primary text-white hover:bg-primary/90 text-lg py-6 shadow-lg"
                  disabled={form.formState.isSubmitting}
                >
                  Entrar
              </Button>
            </form>
          </Form>
      </div>
    </div>
  );
}
