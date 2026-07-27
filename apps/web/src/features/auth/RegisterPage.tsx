import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@aftergame/shared';
import { useSession } from './SessionProvider.js';
import { Button, ErrorText, Field } from '@aftergame/ui';
import { AuthLayout } from './AuthLayout.js';
import { useT } from '../../shared/i18n/LocaleProvider.js';
import { fieldErrorsFor, useErrorMessage } from '../../shared/lib/error-copy.js';
import { focusFirstInvalid } from '../../shared/lib/form.js';

/** Visual order, so "first invalid" is the first one on screen. */
const FIELD_ORDER = ['username', 'email', 'password'] as const;

export default function RegisterPage() {
  const t = useT();
  const messageFor = useErrorMessage();
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
      // Registration signs you straight in; a second login form here would be friction with no
      // security benefit.
      await register(parsed.data);
      await navigate('/', { replace: true });
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
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="text-[var(--color-accent)] underline underline-offset-2">
            {t('auth.signIn')}
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
          label={t('auth.username')}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
          error={errors.username}
          required
          autoComplete="nickname"
          hint={t('auth.usernameHint')}
          disabled={pending}
        />

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
          autoComplete="email"
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
          autoComplete="new-password"
          hint={t('auth.passwordHint', { count: PASSWORD_MIN_LENGTH })}
          disabled={pending}
        />

        <Button type="submit" variant="primary" pending={pending} className="mt-2 w-full">
          {t('auth.register')}
        </Button>
      </form>
    </AuthLayout>
  );
}
