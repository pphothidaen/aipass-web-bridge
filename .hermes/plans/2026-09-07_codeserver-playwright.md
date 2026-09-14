# code-server + Playwright E2E Test Plan

**Goal:** Test AiPASS Chat webview buttons (🔄 📁 ↺) and chat using code-server + Playwright

**Created:** 2026-09-07

---

## Problem

`computer_use` synthetic clicks don't reach VS Code webview because webviews run in a separate Electron process.

**Solution:** code-server serves VS Code in a regular browser — the webview iframe becomes accessible to Playwright.

---

## Architecture

```
Browser (Playwright)
  └── code-server (http://127.0.0.1:8080)
        └── VS Code UI
              ├── Activity Bar → Click AiPASS icon
              └── Sidebar → WebView iframe
                    ├── #refresh-models-btn (🔄)
                    ├── #browse-path-btn (📁)
                    ├── #reset-path-btn (↺)
                    ├── #input (textarea)
                    └── #send-btn
```

---

## Step-by-Step Tasks

### Task 1: Start code-server

```bash
code-server --auth none --port 8080 --bind-addr 127.0.0.1:8080
```

Verify: `curl -s http://127.0.0.1:8080/` returns HTML

### Task 2: Install Playwright

```bash
npm install -g playwright
npx playwright install chromium
```

### Task 3: Create Playwright config

**File:** `packages/vscode-extension/playwright.config.ts`

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:8080',
    headless: true,
  },
});
```

### Task 4: Create E2E test

**File:** `packages/vscode-extension/tests/webview.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test('VS Code loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.monaco-workbench', { timeout: 30000 });
});

test('open AiPASS sidebar and click buttons', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.monaco-workbench', { timeout: 30000 });
  
  // Click AiPASS icon in activity bar
  await page.click('.action-label[aria-label*="AiPASS"]');
  
  // Wait for sidebar to appear
  await page.waitForTimeout(3000);
  
  // Get the webview iframe
  const iframe = page.frameLocator('iframe[name*="webview"]');
  
  // Test 🔄 refresh button
  await iframe.locator('#refresh-models-btn').click();
  await page.waitForTimeout(1000);
  
  // Verify model dropdown has options
  const optionsCount = await iframe.locator('#model-select option').count();
  expect(optionsCount).toBeGreaterThan(0);
  
  // Test 📁 browse folder button
  await iframe.locator('#browse-path-btn').click();
  await page.waitForTimeout(2000);
  // Native dialog may not be visible to Playwright
  
  // Test ↺ reset path button
  await iframe.locator('#reset-path-btn').click();
  await page.waitForTimeout(1000);
  
  // Type and send message
  await iframe.locator('#input').fill('สวัสดีครับ ทดสอบระบบ');
  await iframe.locator('#input').press('Enter');
  await page.waitForTimeout(2000);
  
  // Verify message in chat history
  const userMsg = iframe.locator('.message.user-msg');
  await expect(userMsg).toBeVisible();
});
```

### Task 5: Run tests

```bash
cd packages/vscode-extension
npx playwright test
```

---

## Risks

1. **Webview iframe access:** In code-server, the webview iframe may be cross-origin or use a special protocol. If `frameLocator` fails, we need to use `page.evaluate()` to access iframe content.
2. **Timing:** VS Code takes 10-30s to fully load. Tests need generous timeouts.
3. **Native dialogs:** 📁 opens a native macOS dialog that Playwright can't interact with.
4. **AI response:** Chat tests may take 30-60s depending on model.

---

## Alternative: Direct iframe access

If `frameLocator` doesn't work:

```typescript
await page.evaluate(() => {
  const iframe = document.querySelector('iframe[name*="webview"]') as HTMLIFrameElement;
  if (iframe && iframe.contentDocument) {
    const doc = iframe.contentDocument;
    const btn = doc.getElementById('refresh-models-btn');
    if (btn) btn.click();
  }
});
```
