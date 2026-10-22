import { test, expect } from '@playwright/test';

// Wallet-less interactive smoke. The real credential issue + borrow/repay flow
// needs MetaMask (manual by design — see E2E_TEST_REPORT.md); this spec only
// exercises UI interactivity that is possible without a wallet.
test('homepage interactive flow (no wallet)', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await expect(page.locator('text=Prove Credit')).toBeVisible();

  // Credential issuance is wallet-gated: the button must render and be disabled
  const issueBtn = page.locator('button:has-text("Get Credit Credential")');
  await expect(issueBtn).toBeVisible();
  await expect(issueBtn).toBeDisabled();

  // Nav anchor scrolls to the flow section
  await page.locator('a:has-text("Get Started")').click();
  await page.waitForTimeout(500);

  // Flow explainer is rendered
  await expect(page.locator('text=How CredPass Works')).toBeVisible();

  // On-chain section renders without a wallet
  await expect(page.locator('text=Pool & Loan State (On-Chain)')).toBeVisible();

  await page.screenshot({ path: 'interactive-test.png', fullPage: true });
  console.log('Interactive test passed');
});
