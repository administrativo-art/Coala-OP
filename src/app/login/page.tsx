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
    if (!success) {
      setError("E-mail ou senha inválidos. Verifique seus dados e tente novamente.");
    }
  }

  if (loading || isAuthenticated) {
    return <div className="flex h-screen items-center justify-center">Carregando...</div>;
  }

  return (
    <div className="relative min-h-screen overflow-hidden font-sans">
      <div className="absolute inset-0">
        <img
          src={brand.loginBg}
          alt=""
          aria-hidden
          className="h-full w-full scale-[1.18] -translate-x-[10%] object-cover object-center"
        />
        <div className="absolute inset-0 bg-white/18" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.42),transparent_28%),radial-gradient(circle_at_80%_25%,rgba(255,255,255,0.22),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.02))]" />
      </div>

      <div className="relative min-h-screen">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[34rem] bg-gradient-to-l from-white/16 via-white/6 to-transparent lg:block" />

        <div className="relative flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:justify-end lg:px-12 xl:px-0">
          <div
            className="w-full max-w-[420px] rounded-[28px] border border-white/60 bg-white/82 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.10)] backdrop-blur-[18px] sm:p-10 lg:absolute lg:top-1/2 lg:-translate-y-1/2"
            style={{ right: "6%" }}
          >
            <div className="mb-10">
              <h2 className="text-[22px] font-bold leading-tight tracking-[-0.3px] text-[#1a1a1a]">
                Coala Shakes
              </h2>
              <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                Gestão inteligente
              </p>
            </div>

            <div className="mb-8">
              <h1 className="text-[28px] font-extrabold tracking-[-0.5px] text-[#1a1a1a]">
                Acesso ao sistema
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Entre com suas credenciais para continuar
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[13px] font-semibold text-[#444]">
                  E-mail
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  autoComplete="email"
                  {...register("email")}
                  className="h-12 rounded-xl border-[1.5px] border-[#e0e0e0] bg-white/70 px-4 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-[border-color,box-shadow] focus-visible:border-[#E91E8C] focus-visible:ring-[3px] focus-visible:ring-[#E91E8C]/12 focus-visible:ring-offset-0"
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[13px] font-semibold text-[#444]">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register("password")}
                    className="h-12 rounded-xl border-[1.5px] border-[#e0e0e0] bg-white/70 px-4 pr-11 text-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-[border-color,box-shadow] focus-visible:border-[#E91E8C] focus-visible:ring-[3px] focus-visible:ring-[#E91E8C]/12 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-[#C4187A]"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              {error && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="h-14 w-full rounded-xl bg-[#E91E8C] text-[15px] font-bold tracking-[0.2px] text-white shadow-[0_8px_24px_rgba(233,30,140,0.22)] transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-[#C4187A] hover:shadow-[0_4px_20px_rgba(233,30,140,0.35)] active:translate-y-0"
                size="lg"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <LogIn className="mr-2 h-5 w-5" />
                )}
                {isSubmitting ? "Autenticando..." : "Entrar no sistema"}
              </Button>
            </form>

            <p className="mt-8 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              © {new Date().getFullYear()} Coala Operação. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
