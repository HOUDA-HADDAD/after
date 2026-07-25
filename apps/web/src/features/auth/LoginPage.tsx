import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@aftergame/shared';
import { useSession } from './SessionProvider.js';
import { AuthCard, Field, FormError, SubmitButton } from './AuthForm.js';
import { fieldErrorsFor, messageFor } from '../../shared/lib/error-copy.js';

export default function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    // The same schema the API validates with, so the client cannot build a request the server
    // would reject on shape.
    const parsed = loginSchema.safeParse({ email, password });

    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }

    setErrors({});
    setPending(true);

    try {
      await login(parsed.data);
      // Send the user back where they were headed before being asked to sign in.
      const state = location.state as { from?: string } | null;
      await navigate(state?.from ?? '/', { replace: true });
    } catch (error) {
      setFormError(messageFor(error));
      setErrors(fieldErrorsFor(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          No account yet?{' '}
          <Link
            to="/register"
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormError message={formError} />

        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          autoComplete="username"
          disabled={pending}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="current-password"
          disabled={pending}
        />

        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
