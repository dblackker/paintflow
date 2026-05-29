import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { API_URL } from '@/lib/api';

const DEMO_EMAIL = 'demo@goldenbrush.crewmodo.local';
const DEMO_LOGIN_EMAILS = new Set([
  DEMO_EMAIL,
  'nick@goldenbrush.example',
  'maria@goldenbrush.example',
  'devon@goldenbrush.example',
  'sam@goldenbrush.example',
]);

type Message = {
  tone: 'success' | 'error' | 'info';
  text: string;
  href?: string;
  hrefLabel?: string;
};

function isDemoOrDev() {
  return Boolean(import.meta.env.DEV)
    || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    || window.location.hostname === 'crewmodo-demo.pages.dev'
    || API_URL.includes('crewmodo-api-demo');
}

function appOrigin() {
  if (window.location.hostname === '127.0.0.1') {
    return `${window.location.protocol}//localhost:${window.location.port}`;
  }
  return window.location.origin;
}

function demoApiUrl() {
  if (window.location.hostname === '127.0.0.1' && API_URL.includes('127.0.0.1')) {
    return API_URL.replace('127.0.0.1', 'localhost');
  }
  return API_URL;
}

function demoRedirectPath(email: string) {
  return email.endsWith('@goldenbrush.example') ? '/time' : '/dashboard';
}

function messageClass(tone: Message['tone']) {
  if (tone === 'error') return 'border-red-200 bg-red-50 text-red-800';
  if (tone === 'success') return 'border-green-200 bg-green-50 text-green-800';
  return 'border-blue-200 bg-blue-50 text-blue-900';
}

export function Login() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [shortcutClicks, setShortcutClicks] = useState(0);
  const canUseDemo = useMemo(() => isDemoOrDev(), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      setMessage({ tone: 'error', text: error });
    }
  }, []);

  function signInToDemo(rawEmail = DEMO_EMAIL) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    setMessage({ tone: 'success', text: 'Signing you in to the demo workspace...' });

    const redirectTo = `${appOrigin()}${demoRedirectPath(normalizedEmail)}`;
    const url = new URL('/v1/auth/demo-login', demoApiUrl());
    url.searchParams.set('email', normalizedEmail);
    url.searchParams.set('redirectTo', redirectTo);
    window.location.assign(url.toString());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage({ tone: 'error', text: 'Enter your email address.' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      if (canUseDemo && DEMO_LOGIN_EMAILS.has(normalizedEmail)) {
        signInToDemo(normalizedEmail);
        return;
      }

      const response = await fetch(`${API_URL}/v1/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send magic link');
      }

      if (payload.autoLogin && payload.redirectUrl) {
        setMessage({ tone: 'success', text: 'Signing you in to the demo workspace...' });
        window.location.assign(payload.redirectUrl);
        return;
      }

      setEmail('');
      setMessage({
        tone: 'success',
        text: 'If a workspace exists for that email, we will send a one-time sign-in link.',
        href: payload.devToken ? `${API_URL}/v1/auth/verify?token=${payload.devToken}` : undefined,
        hrefLabel: payload.devToken ? 'Development sign-in shortcut' : undefined,
      });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleExpiresClick() {
    if (!canUseDemo) return;
    const next = shortcutClicks + 1;
    if (next >= 12) {
      setShortcutClicks(0);
      signInToDemo();
      return;
    }
    setShortcutClicks(next);
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:flex sm:items-center sm:justify-center sm:px-6">
      <section className="mx-auto w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="text-center">
          <Link to="/" className="text-2xl font-bold text-blue-700">Crewmodo</Link>
          <h1 className="pf-page-title mt-6">Sign in</h1>
          <p className="pf-page-copy mt-2">Use a secure one-time email link to access your workspace.</p>
        </div>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="send"
            required
            value={email}
            placeholder="you@company.com"
            onChange={(event) => setEmail(event.target.value)}
          />

          <Button type="submit" fullWidth isLoading={isSubmitting} disabled={!email.trim()}>
            Email me a sign-in link
          </Button>
        </form>

        <p className="pf-meta mt-5 text-center">
          No password to remember. Each link{' '}
          <button
            type="button"
            className="cursor-default underline decoration-transparent"
            onClick={handleExpiresClick}
            aria-label={canUseDemo ? 'Demo shortcut trigger' : undefined}
          >
            expires
          </button>{' '}
          after 15 minutes.
        </p>

        {message && (
          <div className={`mt-5 rounded-lg border p-4 ${messageClass(message.tone)}`}>
            <p className="pf-copy text-current">{message.text}</p>
            {message.href && message.hrefLabel && (
              <a href={message.href} className="btn-text mt-2 justify-start p-0 text-current underline">
                {message.hrefLabel}
              </a>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-gray-100 pt-5 text-center">
          <p className="pf-meta">New company?</p>
          <Link to="/signup" className="btn-text mt-1 justify-center">Create a workspace</Link>
        </div>
      </section>
    </main>
  );
}
