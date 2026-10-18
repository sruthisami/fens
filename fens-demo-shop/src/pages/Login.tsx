import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = new URLSearchParams(location.search);
  const redirectTarget = searchParams.get('redirect') || '/';
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        const form = e.currentTarget;
        const emailInput = form.elements.namedItem('login-email') as HTMLInputElement | null;
        const passwordInput = form.elements.namedItem('login-password') as HTMLInputElement | null;
        const email = emailInput?.value?.trim() || '';
        const password = passwordInput?.value || '';
        if (!email || !password) {
          setError('Email and password are required');
          setLoading(false);
          return;
        }
        try {
          await login(email, password);
          navigate(redirectTarget);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <h1>Sign in</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        Demo account: <code>demo@fence.com</code> / <code>password123</code>
      </p>
      <FormField id="login-email" label="Email" type="email" autoComplete="email" />
      <FormField
        id="login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
      />
      <PrimaryButton type="submit">{loading ? 'Signing in…' : 'Sign in'}</PrimaryButton>
      <p>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p>
        Don't have an account? <Link to={`/signup${location.search}`}>Create account</Link>
      </p>
    </form>
  );
}
