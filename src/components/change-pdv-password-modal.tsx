'use client';

import { useEffect, useState } from 'react';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';

import { auth } from '@/lib/firebase';
import type { UserPdvAccess } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function ChangePdvPasswordModal({
  open,
  onOpenChange,
  accesses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accesses: UserPdvAccess[];
}) {
  const { toast } = useToast();
  const [accessId, setAccessId] = useState('');
  const [coalaPassword, setCoalaPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setAccessId(accesses[0]?.externalUserId ?? '');
    else {
      setCoalaPassword('');
      setNewPassword('');
      setConfirmation('');
      setError('');
    }
  }, [open, accesses]);

  const firebaseUser = auth.currentUser;
  const usesPassword = firebaseUser?.providerData.some((provider) => provider.providerId === 'password') ?? true;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!accessId || !/^[1-9]\d{3}$/.test(newPassword)) {
      setError('A nova senha deve ter exatamente 4 números e não pode começar com zero.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('As senhas do PDV não coincidem.');
      return;
    }
    if (!firebaseUser) {
      setError('Entre novamente no Coala One antes de alterar a senha.');
      return;
    }
    setBusy(true);
    try {
      if (usesPassword) {
        if (!firebaseUser.email || !coalaPassword) throw new Error('Informe sua senha atual do Coala One.');
        await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email, coalaPassword));
      } else if (firebaseUser.providerData.some((provider) => provider.providerId === 'google.com')) {
        await reauthenticateWithPopup(firebaseUser, new GoogleAuthProvider());
      } else {
        throw new Error('Não foi possível confirmar sua identidade. Entre novamente no Coala One.');
      }
      const token = await firebaseUser.getIdToken(true);
      const response = await fetch('/api/auth/pdv-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessId, newPassword }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error?.message === 'string' ? payload.error.message : 'Não foi possível alterar a senha do PDV Legal.');
      }
      onOpenChange(false);
      toast({ title: 'Senha do PDV Legal alterada.' });
    } catch (cause) {
      setError(cause instanceof Error && !('code' in cause) ? cause.message : 'Não foi possível confirmar sua identidade ou atualizar o PDV. Confira os dados e tente novamente.');
    } finally {
      setBusy(false);
      setCoalaPassword('');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar senha do PDV Legal</DialogTitle>
          <DialogDescription>A senha do PDV tem 4 números e é independente da senha do Coala One.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {accesses.length > 1 && (
            <label className="block space-y-1 text-sm font-medium">Acesso ao PDV
              <select className="h-10 w-full rounded-md border px-3" value={accessId} onChange={(event) => setAccessId(event.target.value)}>
                {accesses.map((access) => <option key={access.externalUserId} value={access.externalUserId}>{access.filialName || access.unitName || `Acesso ${access.externalUserId}`}</option>)}
              </select>
            </label>
          )}
          {usesPassword && <label className="block space-y-1 text-sm font-medium">Senha atual do Coala One
            <Input type="password" autoComplete="current-password" value={coalaPassword} onChange={(event) => setCoalaPassword(event.target.value)} required />
          </label>}
          {!usesPassword && <p className="text-sm text-muted-foreground">Confirme sua conta Google ao salvar.</p>}
          <label className="block space-y-1 text-sm font-medium">Nova senha do PDV Legal
            <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={newPassword} onChange={(event) => setNewPassword(event.target.value.replace(/\D/g, '').slice(0, 4))} required />
          </label>
          <label className="block space-y-1 text-sm font-medium">Confirme a nova senha do PDV
            <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={confirmation} onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, '').slice(0, 4))} required />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy || accesses.length === 0}>{busy ? 'Alterando...' : 'Alterar senha do PDV'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
