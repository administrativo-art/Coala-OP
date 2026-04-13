"use client";

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface DPGuardProps {
  children: React.ReactNode;
  area: string;
}

interface DPGuardState {
  error: Error | null;
}

export class DPRuntimeGuard extends React.Component<DPGuardProps, DPGuardState> {
  state: DPGuardState = { error: null };

  static getDerivedStateFromError(error: Error): DPGuardState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[DPRuntimeGuard] Failed to render ${this.props.area}.`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const isDPContextError = this.state.error.message.includes('useDP must be used within a DPProvider');

    return (
      <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Falha ao carregar {this.props.area}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {isDPContextError
              ? 'O módulo carregou sem acessar o mesmo DPProvider do restante da aplicação. Isso costuma acontecer quando há chunk/contexto duplicado no bundle publicado.'
              : 'O módulo lançou uma exceção em runtime antes de concluir a renderização.'}
          </p>
          <p className="font-mono text-xs break-words opacity-90">{this.state.error.message}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={this.handleRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Recarregar página
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
}
