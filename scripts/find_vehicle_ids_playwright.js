#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_/]+/g, '')
    .replace(/plus/g, '+');
}

function matchesQuery(text, query) {
  const t = normalize(text);
  const q = normalize(query);
  const variants = new Set([q, q.replace(/\+/g, 'plus'), q.replace(/plus/g, '+')]);
  for (const v of variants) {
    if (v && t.includes(v)) return true;
  }
  return false;
}

async function verifyPage(page, url, query) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText().catch(() => '');
    const text = `${title}\n${body}`;
    return matchesQuery(text, query);
  } catch (e) {
    return false;
  }
}

async function verifyAutohomeSeries(page, seriesId, query) {
  const url = `https://k.autohome.com.cn/${seriesId}?dimensionid=10&order=0&yearid=0#listcontainer`;
  const ok = await verifyPage(page, url, query);
  return ok ? url : null;
}

async function findAutohome(page, query) {
  const searchUrls = [
    `https://k.autohome.com.cn/search/search?query=${encodeURIComponent(query)}`,
    `https://so.autohome.com.cn/search?q=${encodeURIComponent(query)}`
  ];

  const candidates = [];
  const seen = new Set();

  for (const searchUrl of searchUrls) {
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    } catch (e) {
      continue;
    }

    const links = await page.locator('a[href*="autohome.com.cn/"]').evaluateAll(els =>
      els.map(a => ({ href: a.href, text: (a.textContent || '').trim() }))
    ).catch(() => []);

    for (const item of links) {
      let m = item.href.match(/https?:\/\/k\.autohome\.com\.cn\/(\d+)\/(\d+)/);
      if (m) {
        const seriesId = m[1];
        const key = `series|${seriesId}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ id: seriesId, url: `https://k.autohome.com.cn/${seriesId}?dimensionid=10&order=0&yearid=0#listcontainer`, title: item.text, kind: 'koubei_series', evidenceUrl: item.href });
        }
        continue;
      }

      m = item.href.match(/https?:\/\/k\.autohome\.com\.cn\/spec\/(\d+)\/?/);
      if (m) {
        const specId = m[1];
        const key = `spec|${specId}|${item.href}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ id: specId, url: item.href, title: item.text, kind: 'koubei_spec' });
        }
        continue;
      }

      m = item.href.match(/https?:\/\/www\.autohome\.com\.cn\/(\d+)\/?/);
      if (m) {
        const id = m[1];
        const url = `https://www.autohome.com.cn/${id}/`;
        const key = `main|${id}|${url}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({ id, url, title: item.text, kind: 'main_series' });
        }
      }
    }
  }

  for (const c of candidates.slice(0, 20)) {
    if (c.kind === 'koubei_series') {
      const verifiedUrl = await verifyAutohomeSeries(page, c.id, query);
      if (verifiedUrl) {
        return { best: { ...c, url: verifiedUrl }, candidates };
      }
    } else if (c.kind === 'main_series') {
      if (await verifyPage(page, c.url, query)) {
        return { best: c, candidates };
      }
    } else if (c.kind === 'koubei_spec') {
      if (await verifyPage(page, c.url, query)) {
        c.note = 'spec页命中，仅作车型证据，非最终seriesId';
      }
    }
  }

  return { best: null, candidates };
}

function normalizeQueryVariants(query) {
  const variants = [query];
  const spaced = query
    .replace(/([A-Za-z0-9])(?=(PLUS|PRO|MAX|EV|DM|L)\b)/gi, '$1 ')
    .replace(/(?<=[\u4e00-\u9fffA-Za-z0-9])(?=(PLUS|PRO|MAX|EV|DM|L)\b)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced && !variants.includes(spaced)) variants.push(spaced);
  const compact = query.replace(/\s+/g, '');
  if (compact && !variants.includes(compact)) variants.push(compact);
  return variants;
}

async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const currentUrl = page.url();
    if (currentUrl.startsWith('chrome-error://')) return false;
    return true;
  } catch (e) {
    return false;
  }
}

async function findDongchedi(page, query) {
  const queryVariants = normalizeQueryVariants(query);
  const searchUrls = queryVariants.flatMap(q => [
    `https://www.dongchedi.com/search?keyword=${encodeURIComponent(q)}`,
    `https://www.dongchedi.com/auto/library/x-x-x-x-x-x-x-x-x-x-${encodeURIComponent(q)}`
  ]);

  const candidates = [];
  const seen = new Set();

  for (const searchUrl of searchUrls) {
    const ok = await safeGoto(page, searchUrl);
    if (!ok) continue;

    const links = await page.locator('a').evaluateAll(els =>
      els.map(a => ({ href: a.href, text: (a.textContent || '').trim() }))
    ).catch(() => []);

    for (const item of links) {
      let m = item.href.match(/https?:\/\/www\.dongchedi\.com\/auto\/series\/(\d+)/);
      if (m) {
        const id = m[1];
        const url = `https://www.dongchedi.com/auto/series/${id}`;
        const key = `series|${id}|${url}`;
        if (!seen.has(key) && matchesQuery(item.text, query)) {
          seen.add(key);
          candidates.push({ id, url, title: item.text, kind: 'series', evidenceUrl: item.href });
        }
        continue;
      }

      m = item.href.match(/https?:\/\/www\.dongchedi\.com\/community\/(\d+)(?:\/wenda)?/);
      if (m) {
        const id = m[1];
        const url = `https://www.dongchedi.com/auto/series/${id}`;
        const key = `community|${id}|${url}`;
        if (!seen.has(key) && matchesQuery(item.text, query)) {
          seen.add(key);
          candidates.push({ id, url, title: item.text, kind: 'community', evidenceUrl: item.href });
        }
        continue;
      }
    }
  }

  for (const c of candidates.slice(0, 12)) {
    if (await verifyPage(page, c.url, query)) {
      return { best: c, candidates, queryVariants };
    }
  }

  return { best: null, candidates, queryVariants };
}

function runPythonFallback(query, site) {
  try {
    const script = path.join(__dirname, 'find_vehicle_ids.py');
    const stdout = execFileSync('python3', [script, query, '--json', '--site', site], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 45000
    });
    const payload = JSON.parse(stdout);
    return payload[site] || null;
  } catch (e) {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const filtered = args.filter(x => x !== '--json');
  const query = filtered.join(' ').trim();
  if (!query) {
    console.error('Usage: node find_vehicle_ids_playwright.js [--json] <车型名>');
    process.exit(1);
  }

  const proxyServer = process.env.PLAYWRIGHT_PROXY_SERVER || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  const launchOptions = { headless: true };
  if (proxyServer) {
    launchOptions.proxy = { server: proxyServer };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    locale: 'zh-CN'
  });

  const result = { query, autohome: null, dongchedi: null, warnings: [] };
  try {
    const autohomePage = await context.newPage();
    try {
      result.autohome = await findAutohome(autohomePage, query);
    } catch (e) {
      result.autohome = { best: null, candidates: [], error: String(e && e.message ? e.message : e) };
      result.warnings.push('autohome playwright lookup failed');
    } finally {
      await autohomePage.close().catch(() => {});
    }
    if (!result.autohome?.best) {
      const fallback = runPythonFallback(query, 'autohome');
      if (fallback) {
        result.autohome = fallback;
        result.warnings.push('autohome fallback: python');
      }
    }

    const dongchediPage = await context.newPage();
    try {
      result.dongchedi = await findDongchedi(dongchediPage, query);
    } catch (e) {
      result.dongchedi = { best: null, candidates: [], error: String(e && e.message ? e.message : e) };
      result.warnings.push('dongchedi playwright lookup failed');
    } finally {
      await dongchediPage.close().catch(() => {});
    }
    if (!result.dongchedi?.best) {
      const fallback = runPythonFallback(query, 'dongchedi');
      if (fallback) {
        result.dongchedi = fallback;
        result.warnings.push('dongchedi fallback: python');
      }
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }
}

main().catch(err => {
  const payload = {
    error: String(err && err.message ? err.message : err),
    hint: '检查代理/网络；可设置 PLAYWRIGHT_PROXY_SERVER 或 HTTP_PROXY / HTTPS_PROXY 后重试'
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
