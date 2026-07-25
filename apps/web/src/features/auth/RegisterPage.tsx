import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@aftergame/shared';
import { useSession } from './SessionProvider.js';
import { AuthCard, Field, FormError, SubmitButton } from './AuthForm.js';
import { fieldErrorsFor, messageFor } from '../../shared/lib/error-copy.js';

export default function RegisterPage() {
  const { register } = useSession();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({ username, email, password });

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
      // Registration signs you straight in; a second login form here would be friction with no
      // security benefit.
      await register(parsed.data);
      await navigate('/', { replace: true });
    } catch (error) {
      setFormError(messageFor(error));
      setErrors(fieldErrorsFor(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard
      title="Create an account"
      subtitle="You will need one before you can join a group."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormError message={formError} />

        <Field
          id="username"
          label="Username"
          value={username}
          onChange={setUsername}
          error={errors.username}
          autoComplete="nickname"
          hint="Shown to people in your groups. Letters, numbers, and . _ -"
          disabled={pending}
        />

        <Field
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          autoComplete="email"
          disabled={pending}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="new-password"
          hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters. A short phrase beats a complicated word.`}
          disabled={pending}
        />

        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
