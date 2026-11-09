import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { errorMessage, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Button, TextField } from '../../components/ui';

export function LoginPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/auth/login', { email, password });
      await refresh();
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/connexion' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen md:grid-cols-[1fr_1.1fr]">
      <section className="flex flex-col justify-between bg-gls-blue px-10 py-10 text-white">
        <img src="/brand/gls-logo-white-yellowdot.png" alt="GLS" className="h-10 w-auto self-start" />
        <div>
          <h1 className="text-5xl leading-[1.05] font-extrabold text-white">
            Chandelier
            <span className="ml-1 inline-block size-4 rounded-full bg-gls-yellow" aria-hidden="true" />
          </h1>
          <p className="mt-4 max-w-md text-lg text-white/85">
            Registre, qualification AI Act et pilotage de la conformité des systèmes d’intelligence artificielle.
          </p>
        </div>
        <p className="text-xs text-white/60">Application interne — accès réservé aux personnes habilitées.</p>
      </section>
      <section className="flex items-center justify-center bg-white px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5" noValidate>
          <h2 className="text-2xl">Connexion</h2>
          {error && <Alert tone="red">{error}</Alert>}
          <TextField
            label="Adresse e-mail"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </Button>
          <p className="text-xs text-grey-500">
            L’authentification Microsoft Entra ID (SSO) n’est pas encore activée sur cette instance.
          </p>
        </form>
      </section>
    </div>
  );
}
