#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtimeArgument, indexArgument, expectedSlidesArgument, screenshotArgument] = process.argv.slice(2);
if (!runtimeArgument || !indexArgument) {
  throw new Error(
    '用法：node verify_dashi_html_offline.mjs <runtime-root> <index.html> '
    + '[expected-slides] [last-slide-screenshot]',
  );
}

const runtimeRoot = path.resolve(runtimeArgument);
const indexPath = path.resolve(indexArgument);
const expectedSlides = Number(expectedSlidesArgument || 1);
const requireFromRuntime = createRequire(path.join(runtimeRoot, 'package.json'));
const { chromium } = requireFromRuntime('playwright-core');
const { getExportBrowserPath } = await import(
  pathToFileURL(path.join(runtimeRoot, 'scripts', 'chrome-path.mjs')).href
);

const pageErrors = [];
const consoleErrors = [];
let browser;
try {
  browser = await chromium.launch({
    executablePath: getExportBrowserPath(),
    headless: true,
    args: ['--allow-file-access-from-files', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load', timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1_500);

  const slideIds = await page.evaluate(() => (
    [...document.querySelectorAll('#deck > section.slide[data-vm-slide-id]')]
      .map(slide => slide.dataset.vmSlideId || '')
  ));
  const slideChecks = [];
  for (const [index, slideId] of slideIds.entries()) {
    await page.evaluate(targetIndex => {
      if (typeof globalThis.go !== 'function') {
        throw new Error('Dashi 页面导航函数 go 不可用。');
      }
      globalThis.go(targetIndex, { refreshRailThumbs: false });
    }, index);
    await page.waitForFunction(
      targetSlideId => (
        [...document.querySelectorAll('#deck > section.slide[data-vm-slide-id]')]
          .some(slide => (
            slide.dataset.vmSlideId === targetSlideId
            && slide.hasAttribute('data-deck-active')
          ))
      ),
      slideId,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      targetSlideId => {
        const slide = [...document.querySelectorAll('#deck > section.slide[data-vm-slide-id]')]
          .find(candidate => candidate.dataset.vmSlideId === targetSlideId);
        return Boolean(
          slide?.querySelector('.imported-theme-root')?.childElementCount
          || slide?.textContent?.includes('该页渲染失败，内容已跳过'),
        );
      },
      slideId,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(200);
    slideChecks.push(await page.evaluate(targetSlideId => {
      const slide = [...document.querySelectorAll('#deck > section.slide[data-vm-slide-id]')]
        .find(candidate => candidate.dataset.vmSlideId === targetSlideId);
      const text = (slide?.innerText || '').trim();
      return {
        slideId: targetSlideId,
        textLength: text.length,
        rootChildCount: (
          slide?.querySelector('.imported-theme-root')?.childElementCount || 0
        ),
        renderFailureVisible: text.includes('该页渲染失败，内容已跳过'),
      };
    }, slideId));
  }

  const result = await page.evaluate(() => {
    const slides = [...document.querySelectorAll('#deck > section.slide[data-vm-slide-id]')];
    const slideIds = slides.map(slide => slide.dataset.vmSlideId || '');
    return {
      slideCount: slides.length,
      uniqueSlideCount: new Set(slideIds).size,
      slideIds,
      documentTitle: document.title,
    };
  });
  const emptySlideCount = slideChecks.filter(check => check.textLength === 0).length;
  const renderedSlideCount = slideChecks.filter(check => check.rootChildCount > 0).length;
  const renderFailureVisible = slideChecks.some(check => check.renderFailureVisible);
  const lastSlideTextLength = slideChecks.at(-1)?.textLength || 0;

  const lastSlide = page.locator('#deck > section.slide[data-vm-slide-id]').last();
  const activeSlideId = await page
    .locator('#deck > section.slide[data-deck-active]')
    .getAttribute('data-vm-slide-id');
  const expectedLastSlideId = result.slideIds.at(-1) || '';
  let screenshotPath = '';
  if (screenshotArgument) {
    screenshotPath = path.resolve(screenshotArgument);
    await lastSlide.screenshot({ path: screenshotPath });
  }

  const passed = (
    result.slideCount === expectedSlides
    && result.uniqueSlideCount === expectedSlides
    && emptySlideCount === 0
    && renderedSlideCount === expectedSlides
    && lastSlideTextLength > 0
    && activeSlideId === expectedLastSlideId
    && !renderFailureVisible
    && pageErrors.length === 0
    && consoleErrors.length === 0
  );
  process.stdout.write(`${JSON.stringify({
    ...result,
    emptySlideCount,
    renderedSlideCount,
    renderFailureVisible,
    lastSlideTextLength,
    slideChecks,
    activeSlideId,
    expectedLastSlideId,
    screenshotPath,
    pageErrors,
    consoleErrors,
    passed,
  })}\n`);
  if (!passed) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
}
