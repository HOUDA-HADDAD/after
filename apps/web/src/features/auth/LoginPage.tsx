import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { loginSchema } from '@aftergame/shared';
import { useSession } from './SessionProvider.js';
import { Button, ErrorText, Field } from '@aftergame/ui';
import { AuthLayout } from './AuthLayout.js';
import { useT } from '../../shared/i18n/LocaleProvider.js';
import { fieldErrorsFor, useErrorMessage } from '../../shared/lib/error-copy.js';
import { focusFirstInvalid } from '../../shared/lib/form.js';

/** Visual order, so "first invalid" is the first one on screen. */
const FIELD_ORDER = ['email', 'password'] as const;

export default function LoginPage() {
  const t = useT();
  const messageFor = useErrorMessage();
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
      const issues = Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );

      setErrors(issues);
      focusFirstInvalid(FIELD_ORDER, issues);
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
      const issues = fieldErrorsFor(error);

      setFormError(messageFor(error));
      setErrors(issues);
      focusFirstInvalid(FIELD_ORDER, issues);
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="text-[var(--color-accent)] underline underline-offset-2">
            {t('auth.createOne')}
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div aria-live="polite" className="mb-3 min-h-5">
          {formError !== null && <ErrorText>{formError}</ErrorText>}
        </div>

        <Field
          id="email"
          label={t('auth.email')}
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          error={errors.email}
          required
          autoComplete="username"
          disabled={pending}
        />

        <Field
          id="password"
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          error={errors.password}
          required
          revealLabels={{ show: t('auth.showPassword'), hide: t('auth.hidePassword') }}
          autoComplete="current-password"
          disabled={pending}
        />

        <Button type="submit" variant="primary" pending={pending} className="mt-2 w-full">
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  );
}
