import React, { type ReactElement } from 'react';

import { MemoryRouter } from 'react-router-dom';

import { render, type RenderOptions } from '@testing-library/react';

import { LanguageProvider } from '@/shared/providers/language-provider';
import { ThemeProvider } from '@/shared/providers/theme-provider';

interface ProvidersOptions {
  /** Initial route path (defaults to '/') */
  route?: string;
  initialEntries?: string[];
  initialIndex?: number;
}

/**
 * Render a React element wrapped with the app's providers.
 * Use this for component tests that depend on routing, i18n, or theme context.
 */
export function renderWithProviders(
  ui: ReactElement,
  opts?: ProvidersOptions & Omit<RenderOptions, 'wrapper'>,
) {
  const {
    route = '/',
    initialEntries: entries,
    initialIndex: index,
    ...renderOptions
  } = opts ?? {};
  const initialEntries = entries ?? [route];
  const initialIndex = index ?? initialEntries.length - 1;

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <LanguageProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </LanguageProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
