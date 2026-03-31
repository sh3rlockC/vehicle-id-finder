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

## 已验证样例

### 风云X3PLUS

- 汽车之家：`8089`
- 懂车帝：`25398`

### 风云T11

- 汽车之家：`7411`
- 懂车帝：`9436`

## 已知限制

- 站点搜索结构会变，脚本需要持续维护
- 汽车之家里 `seriesId` 与 `specId` 不是一回事，不能混用
- 懂车帝站内搜索结果可能很脏，所以当前实现优先依赖 Tavily 候选召回，再做页面回填校验
- 某些车型如果名字过短、过泛，仍然可能需要增加额外过滤条件
- Playwright 版目前还没有完全同步 Python 版的所有增强逻辑，当前更推荐 Python 版做稳定提取

## 推荐工作流

1. 用户给自然语言车型名
2. 同时查询汽车之家与懂车帝
3. 汽车之家：返回口碑页 `seriesId`
4. 懂车帝：返回 `/auto/series/<id>`
5. 把结果继续喂给口碑采集或车型数据抓取 skill

## 输出建议

默认输出：

- 车型名
- 汽车之家 `seriesId` + 可验证 URL
- 懂车帝 `seriesId` + 可验证 URL
- 若有歧义，附候选项而不是硬猜

## 注意

- 这类站点搜索结构会变，脚本要允许持续修正
- 汽车之家 `seriesId` 与 `specId` 不是一回事
- 懂车帝站内搜索结果可能很脏，优先相信经过 Tavily + 页面回填校验后的结果
- Python 版现在已经适合做轻量稳定提取；Playwright 版适合后续继续增强

## 测试

### 本地最小回归

```bash
python3 scripts/test_cases.py
```

当前内置了两个样例：
- `风云X3PLUS`
- `风云T11`

### GitHub Actions

仓库提供了一个最小 CI：
- Python 脚本语法检查
- Node / Playwright 脚本语法检查

说明：
- 目前 Actions 默认不跑真实联网回归，避免外部站点波动导致 CI 频繁误报
- 真正的联网回归仍建议在本地或人工巡检时执行

## 打包

如果要打成 `.skill`：

```bash
cd skills
zip -r ../vehicle-id-finder.skill vehicle-id-finder
```
