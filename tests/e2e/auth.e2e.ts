import { expect, test } from '@playwright/test';
import { setupClerkTestingToken } from '@clerk/testing/playwright';

test('unauthenticated application routes redirect to Hebrew sign-in', async ({ page, context }) => {
  if (process.env.CLERK_TESTING_TOKEN) await setupClerkTestingToken({ context });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'טוב שחזרת' })).toBeVisible();
});

test('sign-in page has no horizontal overflow', async ({ page, context }) => {
  if (process.env.CLERK_TESTING_TOKEN) await setupClerkTestingToken({ context });
  await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
  const overflows=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflows).toBe(false);
});

test('Clerk SSO callback is handled by the sign-in route', async ({ page }, testInfo) => {
  const dashboardUrl = new URL('/dashboard', testInfo.project.use.baseURL).toString();
  const callbackUrl = `/sign-in/sso-callback?sign_in_force_redirect_url=${encodeURIComponent(dashboardUrl)}`;
  const response = await page.goto(callbackUrl, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).not.toBe(404);
  await expect(page.getByRole('heading', { name: 'טוב שחזרת' })).toBeVisible();
});
