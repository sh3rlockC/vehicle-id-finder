# vehicle-id-finder

根据车型名称查找并提取汽车之家与懂车帝的车型编号（seriesId）及对应车型页 URL。

适合这些场景：
- 用户只给自然语言车型名
- 需要先定位汽车之家 / 懂车帝车型 ID
- 需要为后续口碑采集、车型页抓取、批量数据任务先做 ID 定位

## 当前能力

- 汽车之家：优先走 `k.autohome.com.cn` 口碑链路，提取 `seriesId`
- 懂车帝：优先用 Tavily 做候选召回，再回填校验 `/auto/series/<id>`
- 支持：
  - 汽车之家 `k.autohome.com.cn/<seriesId>` / `k.autohome.com.cn/<seriesId>/<specId>`
  - 懂车帝 `/auto/series/<id>`
  - 懂车帝 `/community/<id>` / `/community/<id>/wenda`
  - 懂车帝 `/auto/params-carIds-x-<id>`

## 目录结构

```text
vehicle-id-finder/
├── SKILL.md
├── README.md
├── references/
│   └── sites.md
└── scripts/
    ├── find_vehicle_ids.py
    └── find_vehicle_ids_playwright.js
```

## 使用方法

### Python 版

查两站：

```bash
python3 skills/vehicle-id-finder/scripts/find_vehicle_ids.py "风云X3PLUS" --site all --json
```

只查汽车之家：

```bash
python3 skills/vehicle-id-finder/scripts/find_vehicle_ids.py "风云X3PLUS" --site autohome --json
```

只查懂车帝：

```bash
python3 skills/vehicle-id-finder/scripts/find_vehicle_ids.py "风云X3PLUS" --site dongchedi --json
```

### Playwright 版

```bash
node skills/vehicle-id-finder/scripts/find_vehicle_ids_playwright.js --json "风云X3PLUS"
```

当前 Playwright 版已增加两层增强：
- 分站独立容错：某一站失败时，不再拖垮另一站结果
- Python fallback：Playwright 原生链路未命中时，会回退到 Python 版兜底

如果当前环境需要代理：

```bash
export PLAYWRIGHT_PROXY_SERVER=http://127.0.0.1:7890
node skills/vehicle-id-finder/scripts/find_vehicle_ids_playwright.js --json "风云X3PLUS"
```

## 查询策略摘要

### 汽车之家

- 优先查询：`site:k.autohome.com.cn <车型名>`
- 命中 `k.autohome.com.cn/<seriesId>/<specId>` 时，取前半段 `seriesId`
- 命中 `spec/<specId>` 时只作为车型证据，不直接当 seriesId
- 最终用：
  - `https://k.autohome.com.cn/<seriesId>?dimensionid=10&order=0&yearid=0#listcontainer`
  做直链确认

### 懂车帝

优先级：
1. `site:dongchedi.com/auto/params <车型名>`
2. `site:dongchedi.com <车型名> 口碑`
3. `site:dongchedi.com <车型名> 评价`

补充规则：
- 对 `PLUS / PRO / MAX / EV / DM / L` 这类后缀，建议同时保留原词和补空格变体
- `params-carIds-x-<id>`、`community/<id>`、`community/<id>/wenda` 都可以作为候选来源
- 最终统一回填验证 `/auto/series/<id>`
- 必须过滤掉标题/snippet 明显命中近似车型的脏候选
- 站内旧搜索链路只作为补充来源，必须带明确车型文本证据后才允许进入候选

## 已验证样例

### 风云X3PLUS

- 汽车之家：`8089`
- 懂车帝：`25398`

### 风云T11

- 汽车之家：`7411`
- 懂车帝：`9436`

## 注意

- 这类站点搜索结构会变，脚本要允许持续修正
- 汽车之家 `seriesId` 与 `specId` 不是一回事
- 懂车帝站内搜索结果可能很脏，优先相信经过 Tavily + 页面回填校验后的结果
- Python 版现在已经适合做轻量稳定提取
- Playwright 版当前已具备独立容错 + Python fallback，稳定性比早期版本明显更好
- 但如果你追求最稳的结果，当前仍建议优先使用 Python 版

## 打包

如果要打成 `.skill`：

```bash
cd skills
zip -r ../vehicle-id-finder.skill vehicle-id-finder
```
