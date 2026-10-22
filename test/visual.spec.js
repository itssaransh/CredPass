import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page.locator('text=Prove Credit')).toBeVisible();
  await page.screenshot({ path: 'homepage.png', fullPage: true });
});
