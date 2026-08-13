/**
 * Site Sign-In Button
 *
 * Opens the companion website login page in the system browser.
 * After successful login, the session is passed back to the desktop app
 * via a temporary localhost callback server.
 */

import { useState } from 'react';

import { cn } from '@/shared/lib/utils';

interface SiteSignInButtonProps {
  onSignIn: () => Promise<void>;
  label: string;
  loadingLabel: string;
  className?: string;
  disabled?: boolean;
}

export function SiteSignInButton({
  onSignIn,
  label,
  loadingLabel,
  className,
  disabled = false,
}: SiteSignInButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading || disabled) return;
    setLoading(true);
    try {
      await onSignIn();
    } catch {
      // Error handled by the parent via useAuth
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled || loading}
      className={cn(
        'flex h-12 items-center gap-3 rounded-lg border px-6 text-sm font-medium shadow-sm transition-all',
        'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 hover:shadow-md',
        'active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-primary/40 dark:bg-primary/10 dark:text-primary dark:hover:bg-primary/20',
        className,
      )}
      aria-label={label}
    >
      {/* Globe icon */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      {loading ? loadingLabel : label}
    </button>
  );
}
