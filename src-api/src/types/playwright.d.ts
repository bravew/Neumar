declare module 'playwright' {
  export interface Route {
    request(): { url(): string };
    continue(): Promise<void>;
    abort(errorCode?: string): Promise<void>;
  }

  export interface Page {
    route(pattern: string, handler: (route: Route) => unknown): Promise<void>;
    goto(
      url: string,
      options?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
        timeout?: number;
      },
    ): Promise<unknown>;
    pdf(options: {
      path: string;
      format?: string;
      printBackground?: boolean;
      preferCSSPageSize?: boolean;
    }): Promise<unknown>;
  }

  export interface Browser {
    newPage(options?: {
      viewport?: { width: number; height: number };
    }): Promise<Page>;
    close(): Promise<void>;
  }

  export const chromium: {
    launch(options?: { headless?: boolean }): Promise<Browser>;
  };
}

declare module '@playwright/test' {
  export { chromium } from 'playwright';
}
