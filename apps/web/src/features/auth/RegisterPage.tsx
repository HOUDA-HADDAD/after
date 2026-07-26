import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@aftergame/shared';
import { useSession } from './SessionProvider.js';
import { Button, ErrorText, Field } from '@aftergame/ui';
import { AuthLayout } from './AuthLayout.js';
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
    <AuthLayout
      title="Create an account"
      subtitle="You will need one before you can join a group."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-[var(--color-accent)] underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div aria-live="polite" className="mb-3 min-h-5">
          {formError !== null && <ErrorText>{formError}</ErrorText>}
        </div>

        <Field
          id="username"
          label="Username"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
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
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          error={errors.email}
          autoComplete="email"
          disabled={pending}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          error={errors.password}
          autoComplete="new-password"
          hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters. A short phrase beats a complicated word.`}
          disabled={pending}
        />

        <Button type="submit" variant="primary" pending={pending} className="mt-2 w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
