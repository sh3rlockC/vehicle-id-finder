#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.parse
from typing import Dict, Any, List

import requests

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
TIMEOUT = 8


def clean_html(text: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def normalize(s: str) -> str:
    s = s.lower()
    s = re.sub(r"[\s\-_/]+", "", s)
    s = s.replace("plus", "+")
    return s


def matches_text(text: str, query: str) -> bool:
    q = normalize(query)
    h = normalize(text)
    variants = {q, q.replace('+', 'plus'), q.replace('plus', '+')}
    return any(v and v in h for v in variants)


def page_matches_query(url: str, query: str) -> bool:
    try:
        html = fetch(url)
    except Exception:
        return False
    return matches_text(clean_html(html), query)


def dedupe(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    uniq = []
    for c in candidates:
        key = (c['id'], c['url'])
        if key not in seen:
            seen.add(key)
            uniq.append(c)
    return uniq


def tavily_search(query: str, max_results: int = 5) -> Dict[str, Any]:
    api_key = os.getenv('TAVILY_API_KEY')
    if not api_key:
        env_path = os.path.expanduser('~/.openclaw/.env')
        try:
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.startswith('TAVILY_API_KEY='):
                        api_key = line.strip().split('=', 1)[1]
                        break
        except Exception:
            pass
    if not api_key:
        return {"results": []}

    try:
        r = requests.post(
            'https://api.tavily.com/search',
            json={
                'api_key': api_key,
                'query': query,
                'max_results': max_results,
                'search_depth': 'basic',
                'include_answer': False,
                'include_raw_content': False,
            },
            headers={**HEADERS, 'Content-Type': 'application/json'},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()
    except Exception:
        return {"results": []}


def verify_autohome_series(series_id: str, query: str) -> bool:
    url = f"https://k.autohome.com.cn/{series_id}?dimensionid=10&order=0&yearid=0#listcontainer"
    try:
        html = fetch(url)
    except Exception:
        return False
    return matches_text(clean_html(html), query)


def verify_dongchedi_series(series_id: str, query: str) -> bool:
    url = f"https://www.dongchedi.com/auto/series/{series_id}"
    try:
        html = fetch(url)
    except Exception:
        return False
    return matches_text(clean_html(html), query)


def evidence_matches_query(item: Dict[str, Any], query: str) -> bool:
    parts = [
        item.get('title', ''),
        item.get('snippet', ''),
        item.get('content', ''),
        item.get('evidence_text', ''),
    ]
    text = '\n'.join([p for p in parts if p])
    return matches_text(text, query)


def normalize_query_variants(query: str) -> List[str]:
    variants = [query]
    spaced = re.sub(r'([A-Za-z0-9])(?=(PLUS|PRO|MAX|EV|DM|L)\b)', r'\1 ', query, flags=re.I)
    spaced = re.sub(r'(?<=[\u4e00-\u9fffA-Za-z0-9])(?=(PLUS|PRO|MAX|EV|DM|L)\b)', ' ', spaced, flags=re.I)
    spaced = re.sub(r'\s+', ' ', spaced).strip()
    if spaced and spaced not in variants:
        variants.append(spaced)
    compact = query.replace(' ', '')
    if compact and compact not in variants:
        variants.append(compact)
    return variants


def search_autohome(query: str) -> Dict[str, Any]:
    q = urllib.parse.quote(query)
    candidates: List[Dict[str, Any]] = []

    # 1) 先走汽车之家口碑域名，优先拿 seriesId
    k_query_url = f"https://k.autohome.com.cn/search/search?query={q}"
    tavily_like_queries = [
        f"site:k.autohome.com.cn {query}",
        f"site:k.autohome.com.cn {query.replace(' ', '')}",
    ]

    urls = [
        k_query_url,
        f"https://so.autohome.com.cn/search?q={q}",
        f"https://www.autohome.com.cn/car/{q}",
    ]

    def collect_from_html(html: str, source: str):
        # k.autohome.com.cn/<seriesId>/<specId>
        for m in re.finditer(r"https?://k\.autohome\.com\.cn/(\d+)/(\d+)", html):
            series_id, spec_id = m.group(1), m.group(2)
            full = m.group(0)
            candidates.append({"id": series_id, "url": f"https://k.autohome.com.cn/{series_id}?dimensionid=10&order=0&yearid=0#listcontainer", "source": source, "evidence_url": full, "kind": "koubei_series"})

        # k.autohome.com.cn/<seriesId>
        for m in re.finditer(r"https?://k\.autohome\.com\.cn/(\d+)(?:\?|/|\")", html):
            series_id = m.group(1)
            candidates.append({"id": series_id, "url": f"https://k.autohome.com.cn/{series_id}?dimensionid=10&order=0&yearid=0#listcontainer", "source": source, "kind": "koubei_series"})

        # spec 页只能当证据，不直接当结果
        for m in re.finditer(r"https?://k\.autohome\.com\.cn/spec/(\d+)/", html):
            spec_id = m.group(1)
            full = m.group(0)
            candidates.append({"id": spec_id, "url": full, "source": source, "kind": "koubei_spec"})

        # 传统 autohome 主站车型页
        for m in re.finditer(r"https?://www\.autohome\.com\.cn/(\d+)/", html):
            sid = m.group(1)
            full = m.group(0)
            candidates.append({"id": sid, "url": full, "source": source, "kind": "main_series"})

        for m in re.finditer(r'"(https?:\\/\\/www\\.autohome\\.com\\.cn\\/(\d+)\\/)"', html):
            escaped_url, sid = m.group(1), m.group(2)
            full = escaped_url.replace('\\/', '/')
            candidates.append({"id": sid, "url": full, "source": source, "kind": "main_series"})

    for url in urls:
        try:
            html = fetch(url)
        except Exception:
            continue
        collect_from_html(html, url)

    # 站内入口不稳时，用 Tavily 兜底召回 k.autohome.com.cn 候选
    if not candidates:
        for tavily_query in tavily_like_queries:
            payload = tavily_search(tavily_query, max_results=8)
            for item in payload.get('results', []):
                bits = [item.get('url', ''), item.get('title', ''), item.get('content', ''), item.get('snippet', '')]
                collect_from_html('\n'.join(bits), f"tavily:{tavily_query}")

    uniq = dedupe(candidates)

    # 优先快速验证 koubei series，命中就尽早返回，避免整轮超时
    koubei_series = [c for c in uniq if c.get('kind') == 'koubei_series']
    for c in koubei_series[:5]:
        if verify_autohome_series(c['id'], query):
            return {"site": "autohome", "best": c, "candidates": koubei_series[:10], "queryHints": tavily_like_queries}

    verified: List[Dict[str, Any]] = []
    main_series = [c for c in uniq if c.get('kind') == 'main_series']
    for c in main_series[:3]:
        if page_matches_query(c['url'], query):
            verified.append(c)

    koubei_specs = [c for c in uniq if c.get('kind') == 'koubei_spec']
    for c in koubei_specs[:3]:
        if page_matches_query(c['url'], query):
            c = dict(c)
            c['note'] = 'spec页命中，仅作车型证据，非最终seriesId'
            verified.append(c)

    best = verified[0] if verified else (uniq[0] if uniq else None)
    return {"site": "autohome", "best": best, "candidates": (verified or uniq)[:10], "queryHints": tavily_like_queries}


def search_dongchedi(query: str) -> Dict[str, Any]:
    candidates: List[Dict[str, Any]] = []
    query_variants = normalize_query_variants(query)

    def collect_id(series_id: str, source: str, kind: str, evidence_url: str = None, evidence_text: str = None):
        candidates.append({
            "id": series_id,
            "url": f"https://www.dongchedi.com/auto/series/{series_id}",
            "source": source,
            "kind": kind,
            **({"evidence_url": evidence_url} if evidence_url else {}),
            **({"evidence_text": evidence_text} if evidence_text else {}),
        })

    # 1) 先用 Tavily 打参数页和口碑页
    for qv in query_variants:
        tavily_queries = [
            f"site:dongchedi.com/auto/params {qv}",
            f"site:dongchedi.com {qv} 口碑",
            f"site:dongchedi.com {qv} 评价",
        ]
        for tq in tavily_queries:
            payload = tavily_search(tq, max_results=8)
            for item in payload.get('results', []):
                url = item.get('url', '')
                title = item.get('title', '')
                snippet = item.get('snippet', '') or item.get('content', '') or ''
                text = '\n'.join([url, title, snippet])
                evidence_match = matches_text(f"{title}\n{snippet}", query)

                for m in re.finditer(r'/auto/series/(\d+)', text):
                    if evidence_match:
                        collect_id(m.group(1), f"tavily:{tq}", 'series', url, f"{title}\n{snippet}")

                for m in re.finditer(r'/community/(\d+)(?:/wenda)?', text):
                    if evidence_match:
                        collect_id(m.group(1), f"tavily:{tq}", 'community', url, f"{title}\n{snippet}")

                for m in re.finditer(r'/auto/params-carIds-(?:x-)?(\d+)', text):
                    if evidence_match:
                        collect_id(m.group(1), f"tavily:{tq}", 'params', url, f"{title}\n{snippet}")

    # 2) 旧站内链路保留为补充，但必须带明确车型文本证据，避免脏候选灌进来
    encoded = urllib.parse.quote(query)
    urls = [
        f"https://www.dongchedi.com/search?keyword={encoded}",
        f"https://www.dongchedi.com/auto/library/x-x-x-x-x-x-x-x-x-x-{encoded}",
    ]
    for url in urls:
        try:
            html = fetch(url)
        except Exception:
            continue

        page_text = clean_html(html)
        if not matches_text(page_text, query):
            continue

        for m in re.finditer(r"https?://www\.dongchedi\.com/auto/series/(\d+)", html):
            collect_id(m.group(1), url, 'series', m.group(0), page_text[:2000])
        for m in re.finditer(r'"/auto/series/(\d+)"', html):
            collect_id(m.group(1), url, 'series', evidence_text=page_text[:2000])
        for m in re.finditer(r'https?://www\.dongchedi\.com/community/(\d+)(?:/wenda)?', html):
            collect_id(m.group(1), url, 'community', m.group(0), page_text[:2000])
        for m in re.finditer(r'https?://(?:m\.)?www\.dongchedi\.com/auto/params-carIds-(?:x-)?(\d+)', html):
            collect_id(m.group(1), url, 'params', m.group(0), page_text[:2000])

    uniq = [c for c in dedupe(candidates) if evidence_matches_query(c, query)]

    def rank(c: Dict[str, Any]):
        source = c.get('source', '')
        kind = c.get('kind', '')
        source_rank = 0 if str(source).startswith('tavily:') else 1
        kind_rank = {'series': 0, 'params': 1, 'community': 2}.get(kind, 9)
        return (source_rank, kind_rank)

    # Tavily 候选优先，站内脏搜索候选靠后；同时优先保留带明确 evidence_url 的候选
    ordered = sorted(
        uniq,
        key=lambda c: (
            rank(c),
            0 if c.get('evidence_url') else 1,
            0 if c.get('kind') == 'series' else 1,
        )
    )
    for c in ordered[:8]:
        if verify_dongchedi_series(c['id'], query):
            return {"site": "dongchedi", "best": c, "candidates": ordered[:10], "queryVariants": query_variants}

    return {"site": "dongchedi", "best": None, "candidates": ordered[:10], "queryVariants": query_variants}


def main() -> int:
    parser = argparse.ArgumentParser(description="Find vehicle series IDs on Autohome and Dongchedi by model name")
    parser.add_argument("query", help="Vehicle model name, e.g. 风云X3PLUS")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument("--site", choices=["all", "autohome", "dongchedi"], default="all", help="Limit lookup to one site")
    args = parser.parse_args()

    result = {"query": args.query}
    if args.site in ("all", "autohome"):
        result["autohome"] = search_autohome(args.query)
    if args.site in ("all", "dongchedi"):
        result["dongchedi"] = search_dongchedi(args.query)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        ah = result.get('autohome', {}).get('best') if result.get('autohome') else None
        dcd = result.get('dongchedi', {}).get('best') if result.get('dongchedi') else None
        print(f"车型: {args.query}")
        if 'autohome' in result:
            if ah:
                print(f"汽车之家: {ah['id']} | {ah['url']}")
            else:
                print("汽车之家: 未找到")
        if 'dongchedi' in result:
            if dcd:
                print(f"懂车帝: {dcd['id']} | {dcd['url']}")
            else:
                print("懂车帝: 未找到")
    return 0


if __name__ == "__main__":
    sys.exit(main())
