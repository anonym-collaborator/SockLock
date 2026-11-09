import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { startServer } from '../src/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'deliverables');
await mkdir(output, { recursive: true });
const server = await startServer(0);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/submission.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const layout = await page.locator('.sheet').evaluateAll(sheets => sheets.map((sheet, index) => {
    const content = sheet.querySelector('.sheet-content');
    const footer = sheet.querySelector('.page-footer');
    const contentRect = content.getBoundingClientRect();
    const lastRect = content.lastElementChild.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return { page: index + 1, height: sheet.clientHeight, scrollHeight: sheet.scrollHeight, lastContentBottom: lastRect.bottom - sheet.getBoundingClientRect().top, footerTop: footerRect.top - sheet.getBoundingClientRect().top, overlapsFooter: lastRect.bottom > footerRect.top - 6, contentOverflow: content.scrollHeight > contentRect.height + 2 };
  }));
  assert.equal(layout.length, 3);
  assert.ok(layout.every(page => !page.overlapsFooter && !page.contentOverflow && page.scrollHeight <= page.height + 2), JSON.stringify(layout, null, 2));
  await page.pdf({ path: resolve(output, 'solution.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  const document = await PDFDocument.load(await readFile(resolve(output, 'solution.pdf')));
  assert.equal(document.getPageCount(), 3, 'The submission must be at most three pages.');
  for (let index = 0; index < 3; index += 1) {
    await page.locator('.sheet').nth(index).screenshot({ path: resolve(output, `document-page-${index + 1}.png`), animations: 'disabled' });
  }
  await writeFile(resolve(output, 'document-check.json'), JSON.stringify({ checkedAt: new Date().toISOString(), pdfPages: document.getPageCount(), layout, language: 'Ukrainian', sources: 8 }, null, 2));
  console.log(JSON.stringify({ pdfPages: document.getPageCount(), layout }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}