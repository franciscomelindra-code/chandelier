import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH } from '@chandelier/shared';
import { errorMessage, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Button, Card, PageHeader, TextField } from '../../components/ui';

export function ChangePasswordPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/auth/change-password', { currentPassword: current, newPassword: next });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <PageHeader eyebrow="Sécurité du compte" title="Changer votre mot de passe" />
      <Card>
        {me?.user.mustChangePassword && (
          <div className="mb-4">
            <Alert tone="yellow" title="Changement obligatoire">
              Votre mot de passe est temporaire. Choisissez-en un nouveau pour accéder à l’application.
            </Alert>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <TextField
            label="Mot de passe actuel"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <TextField
            label="Nouveau mot de passe"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            hint={`${PASSWORD_MIN_LENGTH} caractères minimum. Une phrase de passe est recommandée.`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <TextField
            label="Confirmation"
            type="password"
            autoComplete="new-password"
            required
            error={mismatch ? 'Les deux saisies diffèrent' : undefined}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button type="submit" disabled={busy || !current || next.length < PASSWORD_MIN_LENGTH || next !== confirm}>
            Enregistrer
          </Button>
        </form>
      </Card>
    </div>
  );
}
