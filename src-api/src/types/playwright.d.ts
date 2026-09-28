declare module 'playwright' {
  export interface Route {
    request(): { url(): string };
    continue(): Promise<void>;
    abort(errorCode?: string): Promise<void>;
  }

  export interface Locator {
    locator(selector: string): Locator;
    first(): Locator;
    click(options?: { timeout?: number }): Promise<void>;
    waitFor(options?: {
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
      timeout?: number;
    }): Promise<void>;
  }

  export interface FrameLocator {
    locator(selector: string): Locator;
  }

  export interface Page {
    route(pattern: string, handler: (route: Route) => unknown): Promise<void>;
    frameLocator(selector: string): FrameLocator;
    getByText(text: string | RegExp, options?: { exact?: boolean }): Locator;
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

  export interface LaunchOptions {
    headless?: boolean;
    args?: string[];
    executablePath?: string;
  }

  export const chromium: {
    launch(options?: LaunchOptions): Promise<Browser>;
  };
}

declare module '@playwright/test' {
  export { chromium } from 'playwright';
}
