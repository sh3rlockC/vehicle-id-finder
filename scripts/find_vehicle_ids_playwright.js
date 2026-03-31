#!/usr/bin/env node
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

function normalizeQueryVariants(query) {
  const variants = [query];
  const spaced = query
    .replace(/([A-Za-z0-9])(?=(PLUS|PRO|MAX|EV|DM|L)\b)/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  if (spaced && !variants.includes(spaced)) variants.push(spaced);
  const compact = query.replace(/\s+/g, '');
  if (compact && !variants.includes(compact)) variants.push(compact);
  return variants;
}

async function verifyPage(page, url, query) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
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
  return (await verifyPage(page, url, query)) ? url : null;
}

async function verifyDongchediSeries(page, seriesId, query) {
  const url = `https://www.dongchedi.com/auto/series/${seriesId}`;
  return (await verifyPage(page, url, query)) ? url : null;
}

async function searchTavily(query) {
  // Playwright 版先走 OpenClaw 已配置的 Tavily HTTP 接口环境变量
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 8,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
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
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    } catch {
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
      if (verifiedUrl) return { best: { ...c, url: verifiedUrl }, candidates };
    } else if (c.kind === 'main_series') {
      if (await verifyPage(page, c.url, query)) return { best: c, candidates };
    }
  }

  return { best: null, candidates };
}

async function findDongchedi(page, query) {
  const queryVariants = normalizeQueryVariants(query);
  const candidates = [];
  const seen = new Set();

  for (const qv of queryVariants) {
    const tavilyQueries = [
      `site:dongchedi.com/auto/params ${qv}`,
      `site:dongchedi.com ${qv} 口碑`,
      `site:dongchedi.com ${qv} 评价`
    ];

    for (const tq of tavilyQueries) {
      const results = await searchTavily(tq);
      for (const item of results) {
        const url = item.url || '';
        const title = item.title || '';
        const snippet = item.snippet || item.content || '';
        const text = `${url}\n${title}\n${snippet}`;
        if (!matchesQuery(`${title}\n${snippet}`, query)) continue;

        const patterns = [
          { re: /\/auto\/series\/(\d+)/g, kind: 'series' },
          { re: /\/community\/(\d+)(?:\/wenda)?/g, kind: 'community' },
          { re: /\/auto\/params-carIds-(?:x-)?(\d+)/g, kind: 'params' },
        ];

        for (const p of patterns) {
          for (const m of text.matchAll(p.re)) {
            const id = m[1];
            const key = `${id}|${p.kind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({
              id,
              url: `https://www.dongchedi.com/auto/series/${id}`,
              kind: p.kind,
              source: `tavily:${tq}`,
              evidenceUrl: url,
              evidenceText: `${title}\n${snippet}`,
            });
          }
        }
      }
    }
  }

  const rank = c => {
    const sourceRank = String(c.source || '').startsWith('tavily:') ? 0 : 1;
    const kindRank = { series: 0, params: 1, community: 2 }[c.kind] ?? 9;
    return [sourceRank, kindRank];
  };
  candidates.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1];
  });

  for (const c of candidates.slice(0, 8)) {
    const verifiedUrl = await verifyDongchediSeries(page, c.id, query);
    if (verifiedUrl) return { best: { ...c, url: verifiedUrl }, candidates };
  }

  return { best: null, candidates };
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
  if (proxyServer) launchOptions.proxy = { server: proxyServer };

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    locale: 'zh-CN'
  });
  const page = await context.newPage();

  const result = { query, autohome: null, dongchedi: null };
  try {
    result.autohome = await findAutohome(page, query);
    result.dongchedi = await findDongchedi(page, query);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  const payload = {
    error: String(err && err.message ? err.message : err),
    hint: '检查代理/网络；可设置 PLAYWRIGHT_PROXY_SERVER 或 HTTP_PROXY / HTTPS_PROXY 后重试；Playwright 版还依赖 TAVILY_API_KEY 做懂车帝候选召回'
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
