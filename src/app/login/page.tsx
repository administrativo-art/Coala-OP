"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LogIn, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const loginSchema = z.object({
  email: z.string().email("E-mail inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push("/dashboard");
    }
  }, [isAuthenticated, loading, router]);

  async function onSubmit(data: LoginFormData) {
    setError(null);
    const success = await login(data.email, data.password);
    if (success) {
      router.push("/dashboard");
    } else {
      setError("E-mail ou senha inválidos. Verifique seus dados e tente novamente.");
    }
  }

  if (loading || isAuthenticated) {
    return <div className="flex h-screen items-center justify-center">Carregando...</div>;
  }

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden font-sans">
      {/* Imagem de fundo */}
      <img
        src={brand.loginBg}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "right center" }}
      />

      {/* Overlay */}
      <div className="absolute inset-0 bg-slate-900/20" />

      {/* Layout duas colunas */}
      <div className="relative z-10 flex min-h-screen w-full">
        
        {/* Painel de login (Esquerda) */}
        <div
          className="flex w-full max-w-md flex-col justify-center px-10 py-12 shadow-2xl"
          style={{
            background: "rgba(255, 255, 255, 0.88)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
          }}
        >
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
              Acesso ao Sistema
            </h1>
            <p className="mt-1 text-sm text-slate-500">Entre com suas credenciais para continuar</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-700">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                autoComplete="email"
                {...register("email")}
                className="bg-white/70 h-12 rounded-xl"
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-700">Senha</Label>
              <div className="relative">
                <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register("password")}
                    className="bg-white/70 h-12 rounded-xl pr-10"
                />
                <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive border border-destructive/20">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full h-12 rounded-xl text-base font-semibold shadow-lg shadow-primary/20" size="lg" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-5 w-5" />
              )}
              {isSubmitting ? "Autenticando..." : "Entrar no sistema"}
            </Button>
          </form>

          <p className="mt-8 text-center text-[10px] uppercase tracking-widest text-slate-400 font-bold">
            © {new Date().getFullYear()} Coala Operação. Todos os direitos reservados.
          </p>
        </div>

        {/* Coluna direita (Livre para a imagem) */}
        <div className="hidden lg:flex flex-1 items-center justify-center p-12">
            <div className="max-w-xl text-white space-y-4">
                <h2 className="text-5xl font-bold leading-tight">{brand.name}</h2>
                <p className="text-xl text-white/80">{brand.description}</p>
            </div>
        </div>
      </div>
    </div>
  );
}
