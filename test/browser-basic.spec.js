import { test, expect } from '@playwright/test';

test('homepage basic state (no MetaMask)', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page.locator('text=Prove Credit. Keep Control.')).toBeVisible();
  await expect(page.locator('button:has-text("No Wallet")')).toBeVisible();
  console.log('Basic homepage loaded; wallet disconnected state verified. No MetaMask interaction attempted.');
});

test('on-chain pool panel and contract footer render without wallet', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page.locator('text=Pool & Loan State (On-Chain)')).toBeVisible();
  await expect(page.locator('text=Pool Liquidity')).toBeVisible();
  await expect(page.locator('text=EIP-712 credentials')).toBeVisible();
  console.log('On-chain state panel and contract footer verified (read-only, no wallet).');
});
