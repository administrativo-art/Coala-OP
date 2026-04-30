"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { GlassSidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { DebugPanel } from '@/components/debug-panel';
import { LoginAccessGateOverlay } from '@/components/login-access-gate-overlay';
import { useAllTasks } from '@/hooks/use-all-tasks';
import { useToast } from '@/hooks/use-toast';
import {
  fetchHrLoginAccess,
  submitHrLoginJustification,
  type HrLoginAccessPayload,
} from '@/features/hr/lib/client';
import { LockKeyhole, ShieldAlert } from 'lucide-react';

function shouldSurfaceLoginAccessNotice(payload: HrLoginAccessPayload) {
  return (
    payload.user.loginRestrictionEnabled &&
    (payload.evaluation.reason === 'no_schedule_assigned' ||
      payload.evaluation.reason === 'after_shift_extension_active')
  );
}

function buildLoginAccessMessage(payload: HrLoginAccessPayload) {
  if (payload.evaluation.reason === 'no_schedule_assigned') {
    return {
      title: 'Limitador de login ativo sem escala atribuída',
      description:
        'O acesso segue liberado em modo seguro, mas este colaborador ainda não tem escala vinculada para validação.',
      variant: 'default' as const,
    };
  }

  if (payload.evaluation.reason === 'after_shift_extension_active') {
    return {
      title: 'Acesso liberado por justificativa',
      description: payload.evaluation.allowedUntilLocal
        ? `A extensão atual permanece válida até ${payload.evaluation.allowedUntilLocal}.`
        : 'Existe uma extensão ativa decorrente de justificativa fora do turno.',
      variant: 'default' as const,
    };
  }

  return {
    title: 'Horário fora da janela da escala',
    description:
      'O acesso foi bloqueado pela política de escala deste colaborador.',
    variant: 'destructive' as const,
  };
}

function shouldOpenLoginAccessGate(payload: HrLoginAccessPayload | null) {
  if (!payload) {
    return false;
  }

  return (
    payload.user.loginRestrictionEnabled &&
    payload.evaluation.status === 'blocked' &&
    payload.evaluation.reason !== 'no_schedule_assigned'
  );
}

function LoadingSkeleton() {
    return (
      <div className="flex h-screen w-full">
        <div className="flex flex-col flex-1">
            <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="w-full flex-1"></div>
                <Skeleton className="h-8 w-8 rounded-full" />
            </header>
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-64 w-full" />
            </main>
        </div>
      </div>
    );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { firebaseUser, user, isAuthenticated, loading: authLoading, logout } = useAuth();
  const { taskNotifications } = useAllTasks();
  const { toast } = useToast();
  const router = useRouter();
  const [dataLoadTime, setDataLoadTime] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loginAccessState, setLoginAccessState] = useState<HrLoginAccessPayload | null>(null);
  const [submittingJustification, setSubmittingJustification] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const startTime = performance.now();
    if (!authLoading) {
      const endTime = performance.now();
      setDataLoadTime(endTime - startTime);
      if (!isAuthenticated) {
        router.push('/login');
      }
    }
  }, [isAuthenticated, authLoading, router]);

  const refreshLoginAccessState = useCallback(async () => {
    if (!firebaseUser || !user?.id || !user.loginRestrictionEnabled) {
      setLoginAccessState(null);
      return;
    }

    const payload = await fetchHrLoginAccess(firebaseUser, {});
    setLoginAccessState(payload);

    if (!shouldSurfaceLoginAccessNotice(payload) || typeof window === 'undefined') {
      return;
    }

    const storageKey = [
      'login-access-notice',
      payload.user.id,
      payload.evaluation.reason,
      payload.evaluation.localDate,
      payload.evaluation.activeExtension?.sequence ?? '0',
    ].join(':');

    if (window.sessionStorage.getItem(storageKey)) {
      return;
    }

    window.sessionStorage.setItem(storageKey, '1');
    const message = buildLoginAccessMessage(payload);

    toast({
      title: message.title,
      description: message.description,
      variant: message.variant,
    });
  }, [firebaseUser, toast, user?.id, user?.loginRestrictionEnabled]);

  useEffect(() => {
    if (!isMounted || authLoading || !isAuthenticated || !firebaseUser || !user?.id) {
      return;
    }

    if (!user.loginRestrictionEnabled) {
      setLoginAccessState(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        await refreshLoginAccessState();
      } catch (error) {
        if (!cancelled) {
          console.error('[DashboardLayout] Falha ao avaliar acesso por escala.', error);
        }
      }
    };

    void run();

    const intervalId = window.setInterval(() => {
      void run();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    authLoading,
    firebaseUser,
    isAuthenticated,
    isMounted,
    refreshLoginAccessState,
    user?.id,
    user?.loginRestrictionEnabled,
  ]);

  const handleSubmitJustification = useCallback(async (text: string) => {
    if (!firebaseUser || !user?.id) {
      return;
    }

    setSubmittingJustification(true);

    try {
      const payload = await submitHrLoginJustification(firebaseUser, {
        justificationText: text,
      });
      setLoginAccessState(payload);

      toast({
        title: 'Justificativa registrada',
        description: payload.evaluation.allowedUntilLocal
          ? `Acesso liberado até ${payload.evaluation.allowedUntilLocal}.`
          : 'A extensão foi registrada com sucesso.',
      });
    } catch (error) {
      toast({
        title: 'Falha ao registrar justificativa',
        description:
          error instanceof Error
            ? error.message
            : 'Não foi possível registrar a justificativa agora.',
        variant: 'destructive',
      });
    } finally {
      setSubmittingJustification(false);
    }
  }, [firebaseUser, toast, user?.id]);
  
  if (!isMounted || authLoading || !isAuthenticated) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#f8fafc] dark:bg-[#0f172a]">
       <div className="fixed inset-0 bg-[radial-gradient(at_0%_0%,rgba(124,58,237,0.03)_0,transparent_50%),radial-gradient(at_100%_100%,rgba(236,72,153,0.03)_0,transparent_50%)] pointer-events-none" />
      <GlassSidebar open={isSidebarOpen} onOpenChange={setIsSidebarOpen} />
      <div className="flex flex-col flex-1 lg:pl-64">
        <Header tasks={taskNotifications} onMenuClick={() => setIsSidebarOpen(true)} />
        <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
          {loginAccessState && shouldSurfaceLoginAccessNotice(loginAccessState) && (
            <Alert variant={loginAccessState.evaluation.status === 'blocked' ? 'destructive' : 'default'}>
              {loginAccessState.evaluation.status === 'blocked' ? (
                <ShieldAlert className="h-4 w-4" />
              ) : (
                <LockKeyhole className="h-4 w-4" />
              )}
              <AlertTitle>{buildLoginAccessMessage(loginAccessState).title}</AlertTitle>
              <AlertDescription>
                {buildLoginAccessMessage(loginAccessState).description}
              </AlertDescription>
            </Alert>
          )}
          {children}
        </main>
        {process.env.NODE_ENV === 'development' && <DebugPanel dataLoadTime={dataLoadTime} />}
      </div>
      {shouldOpenLoginAccessGate(loginAccessState) && loginAccessState && (
        <LoginAccessGateOverlay
          payload={loginAccessState}
          submitting={submittingJustification}
          onSubmitJustification={handleSubmitJustification}
          onLogout={logout}
        />
      )}
    </div>
  )
}
