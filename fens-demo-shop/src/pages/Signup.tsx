import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
export function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signup } = useAuth();
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
        const nameInput = form.elements.namedItem('signup-name') as HTMLInputElement | null;
        const emailInput = form.elements.namedItem('signup-email') as HTMLInputElement | null;
        const passwordInput = form.elements.namedItem('signup-password') as HTMLInputElement | null;
        const name = nameInput?.value?.trim() || '';
        const email = emailInput?.value?.trim() || '';
        const password = passwordInput?.value || '';
        if (!email) {
          setError('Email is required');
          setLoading(false);
          return;
        }
        if (!password || password.length < 6) {
          setError('Password must be at least 6 characters');
          setLoading(false);
          return;
        }
        try {
          await signup(name, email, password);
          navigate(redirectTarget);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setLoading(false);
        }
      }}
    >
      <h1>Create account</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <FormField id="signup-name" label="Full name" type="text" autoComplete="name" />
      <FormField id="signup-email" label="Email" type="email" autoComplete="email" />
      <FormField
        id="signup-password"
        label="Password"
        type="password"
        autoComplete="new-password"
      />
      <PrimaryButton type="submit">
        {loading ? 'Creating account…' : 'Create account'}
      </PrimaryButton>
      <p>
        Already have an account? <Link to={`/login${location.search}`}>Sign in</Link>
      </p>
    </form>
  );
}
