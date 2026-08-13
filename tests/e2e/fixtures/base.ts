import { test as base } from '@playwright/test';

import { HomePage } from '../pages/home.page';
import { TaskV2Page } from '../pages/task-v2.page';

type Fixtures = {
  homePage: HomePage;
  taskPage: TaskV2Page;
  apiBaseUrl: string;
};

export const test = base.extend<Fixtures>({
  apiBaseUrl: ['http://localhost:5126', { option: true }],
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  taskPage: async ({ page }, use) => {
    await use(new TaskV2Page(page));
  },
});

export { expect } from '@playwright/test';
