/**
 * Setup Guard Component
 *
 * Checks if Claude Code is installed on app startup.
 * If not installed, renders the SetupPage component.
 * After dependencies are OK, shows onboarding for first-time users.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { OnboardingPage } from '@/app/pages/Onboarding';
import { SetupPage } from '@/app/pages/Setup';
import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { API_BASE_URL } from '@/config';
import { getSettingItem, ONBOARDING_VERSION } from '@/shared/db/settings';
import { useLanguage } from '@/shared/providers/language-provider';

interface SetupGuardProps {
  children: ReactNode;
}

// Cache the check result to avoid repeated API calls during navigation
let cachedInstalled: boolean | null = null;
let cachedOnboardingDone: boolean | null = null;

function shouldBypassSetupGuardForAutomation(): boolean {
  return import.meta.env.DEV && navigator.webdriver === true;
}

async function checkClaudeCode(): Promise<boolean> {
  if (shouldBypassSetupGuardForAutomation()) {
    cachedInstalled = true;
    return true;
  }
  if (cachedInstalled !== null) {
    return cachedInstalled;
  }

  const maxRetries = 10;
  const retryDelay = 500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/health/dependencies`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        const isInstalled = data.claudeCode ?? false;
        cachedInstalled = isInstalled;
        return isInstalled;
      }
    } catch (error) {
      console.warn(
        `[SetupGuard] Check attempt ${attempt + 1}/${maxRetries} failed:`,
        error,
      );
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  return false;
}

async function checkOnboardingCompleted(): Promise<boolean> {
  if (shouldBypassSetupGuardForAutomation()) {
    cachedOnboardingDone = true;
    return true;
  }
  if (cachedOnboardingDone !== null) {
    return cachedOnboardingDone;
  }
  try {
    const [completed, version] = await Promise.all([
      getSettingItem('onboardingCompleted'),
      getSettingItem('onboardingVersion'),
    ]);
    // Require both the completion flag AND the current schema version.
    // Stale data from a prior install (missing onboardingVersion) will return
    // false, ensuring onboarding runs again on a fresh reinstall.
    const done = completed === 'true' && version === ONBOARDING_VERSION;
    cachedOnboardingDone = done;
    return done;
  } catch {
    return false;
  }
}

let cachedQuickstartDone: boolean | null = null;

async function checkQuickstartCompleted(): Promise<boolean> {
  if (shouldBypassSetupGuardForAutomation()) {
    cachedQuickstartDone = true;
    return true;
  }
  if (cachedQuickstartDone !== null) {
    return cachedQuickstartDone;
  }
  try {
    const step = await getSettingItem('quickstart_step');
    const done = step === 'completed';
    cachedQuickstartDone = done;
    return done;
  } catch {
    return false;
  }
}

// Export function to clear cache
export function clearDependencyCache() {
  cachedInstalled = null;
}

export function clearOnboardingCache() {
  cachedOnboardingDone = null;
}

export function clearQuickstartCache() {
  cachedQuickstartDone = null;
}

export function markQuickstartDone() {
  cachedQuickstartDone = true;
}

export function SetupGuard({ children }: SetupGuardProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(true); // default true to avoid flash

  // Check on mount
  useEffect(() => {
    let mounted = true;

    async function runChecks() {
      const isInstalled = await checkClaudeCode();
      if (!mounted) return;
      setInstalled(isInstalled);

      // Only check onboarding + quickstart if dependencies are installed
      if (isInstalled) {
        const [isDone, quickstartDone] = await Promise.all([
          checkOnboardingCompleted(),
          checkQuickstartCompleted(),
        ]);
        if (!mounted) return;
        setOnboardingDone(isDone);

        // If onboarding done but quickstart not, redirect
        if (isDone && !quickstartDone) {
          navigate('/quickstart', { replace: true });
        }
      }

      setChecking(false);
    }

    runChecks();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleOnboardingComplete = useCallback(() => {
    cachedOnboardingDone = true;
    setOnboardingDone(true);
    // After onboarding, redirect to quickstart
    navigate('/quickstart', { replace: true });
  }, [navigate]);

  // Loading state
  if (checking) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <div className="flex flex-col items-center gap-8">
          <AILoadingIndicator size="xl" />
          <p className="text-muted-foreground text-base">
            {t.setup.checkingEnvironment}
          </p>
        </div>
      </div>
    );
  }

  // Not installed - show SetupPage with skip callback
  if (!installed) {
    return (
      <SetupPage
        onSkip={async () => {
          // Check onboarding BEFORE setting installed to avoid a flash
          // where children render briefly while onboarding check is pending
          const isDone = await checkOnboardingCompleted();
          setOnboardingDone(isDone);
          setInstalled(true);
        }}
      />
    );
  }

  // Dependencies OK but onboarding not completed - show onboarding
  if (!onboardingDone) {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  // All good
  return <>{children}</>;
}
