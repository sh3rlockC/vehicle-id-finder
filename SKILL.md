---
name: vehicle-id-finder
description: 根据车型名称查找并提取汽车之家与懂车帝的车型编号（seriesId）及对应车型页 URL。适用于用户只给自然语言车型名、需要定位汽车之家/懂车帝车型链接、需要从链接中提取编号，或要为后续口碑采集、车型页抓取、批量数据任务先做车型 ID 定位时使用。尤其在用户提到“车型编号”“seriesId”“汽车之家链接编号”“懂车帝链接编号”“先查车型 URL/ID”时使用。
---

# 车型编号查找

目标：当用户只给车型名时，先帮他定位该车型在汽车之家和懂车帝的车型页，再提取 URL 中的编号。

## 快速规则

- 汽车之家车型页常见格式：`https://www.autohome.com.cn/<seriesId>/`
- 懂车帝车型页常见格式：`https://www.dongchedi.com/auto/series/<seriesId>`
- 需要输出时，默认同时给：`车型名 + 站点 + 编号 + 可验证 URL`
- 如果结果有歧义，不要硬猜；要返回候选项并说明需要用户确认

如需确认站点 URL 规则，读：`references/sites.md`

## 推荐流程

### 1. 先标准化车型名

保留用户原词，不要自作主张改成别的车。

但可以做轻量兼容：
- 去除首尾空格
- 统一全角/半角空格
- 保留大小写与 `PLUS / Pro / EV / DM / i / L` 等后缀

### 2. 查询两个站点

优先同时查询：
- 汽车之家
- 懂车帝

当前推荐查询策略：
- 汽车之家：优先 `k.autohome.com.cn` 口碑域名
- 懂车帝：优先 Tavily 召回，再回填验证 `/auto/series/<id>`

默认优先使用附带的浏览器脚本：

```bash
node skills/vehicle-id-finder/scripts/find_vehicle_ids_playwright.js --json "风云X3PLUS"
```

若当前环境访问站点需要代理，可先设置：

```bash
export PLAYWRIGHT_PROXY_SERVER=http://127.0.0.1:7890
node skills/vehicle-id-finder/scripts/find_vehicle_ids_playwright.js --json "风云X3PLUS"
```

如果只想做轻量实验，再用 Python 版原型：

```bash
python3 skills/vehicle-id-finder/scripts/find_vehicle_ids.py "风云X3PLUS" --json
```

### 3. 提取并校验编号

提取规则：
- 汽车之家主站车型页：取 `/12345/` 中的数字
- 汽车之家口碑页：优先提取 `https://k.autohome.com.cn/<seriesId>` 或 `https://k.autohome.com.cn/<seriesId>/<specId>` 里的前半段 `<seriesId>`
- 汽车之家 `spec` 页：`https://k.autohome.com.cn/spec/<specId>/` 里的 `<specId>` 只能当候选验证页，**不能直接当 seriesId**
- 懂车帝：取 `/auto/series/12345` 中的数字

汽车之家专项规则：
- 当用户目标是汽车之家口碑采集或需要汽车之家 `seriesId` 时，优先走 `k.autohome.com.cn` 链路
- 推荐查询词：`site:k.autohome.com.cn <车型名>`
- 若命中 `k.autohome.com.cn/<seriesId>/<specId>` 这类 URL，优先取前半段 `<seriesId>` 作为结果
- 若只命中 `k.autohome.com.cn/spec/<specId>/`，先把它当作“车型命中证据”，再继续反查或补查 `seriesId`
- 对提取出的汽车之家 `seriesId`，必须补一轮直链确认：访问 `https://k.autohome.com.cn/<seriesId>?dimensionid=10&order=0&yearid=0#listcontainer`，确认页面标题或正文明确包含目标车型名
- 只有当直链确认通过时，才把该 `seriesId` 作为正式结果输出

懂车帝专项规则：
- 当前优先使用 Tavily 做候选召回，而不是把懂车帝站内搜索当主路径
- 推荐优先级：
  1. `site:dongchedi.com/auto/params <车型名>`
  2. `site:dongchedi.com <车型名> 口碑`
  3. `site:dongchedi.com <车型名> 评价`
- 对 `PLUS / PRO / MAX / EV / DM / L` 这类后缀，建议同时保留原词和“补空格后的变体”一起查询，例如：`风云X3PLUS` 与 `风云X3 PLUS`
- 若命中 `https://www.dongchedi.com/auto/params-carIds-x-<id>`，可将 `<id>` 当作高价值候选，但仍需回填验证 `/auto/series/<id>`
- 若命中 `https://www.dongchedi.com/community/<id>` 或 `/community/<id>/wenda`，可将 `<id>` 当作候选 `seriesId`，再回填验证 `/auto/series/<id>`
- 只有当 `/auto/series/<id>` 页面标题或正文明确命中目标车型名时，才把该 `<id>` 作为正式结果输出
- 对懂车帝 Tavily 候选，要优先看标题/snippet 是否真的命中目标车型名；如果明显命中的是近似车（如 X3L），要直接过滤掉

已验证可行的经验：
- `site:k.autohome.com.cn 风云X3PLUS` 比 `site:autohome.com.cn 风云X3PLUS` 更容易命中汽车之家口碑域名
- `k.autohome.com.cn/<seriesId>/<specId>` 这种结果对提取汽车之家 `seriesId` 很有价值
- `k.autohome.com.cn/spec/<specId>/` 往往能证明车型命中，但不等于最终要交付的 `seriesId`
- 懂车帝里，`community/<id>` 与 `/auto/series/<id>` 可以属于同一主 ID 体系
- 懂车帝参数页 `params-carIds-x-<id>` 对某些车型比“口碑”查询更直接，但必须做车型文本过滤与 `/auto/series/<id>` 回填校验

校验规则：
- 优先返回包含车型页模式的 URL
- 若脚本拿到多个候选，优先选最像车型主页或口碑聚合页的链接
- 若候选明显不止一个且无法确认，回复候选项而不是编造唯一结果
- 正式版必须做“打开候选页再验车型名”这一步，不能只信搜索页第一条

### 4. 输出格式

默认输出示例：

- 汽车之家：8089  
  `https://k.autohome.com.cn/8089?dimensionid=10&order=0&yearid=0#listcontainer`
- 懂车帝：25398  
  `https://www.dongchedi.com/auto/series/25398`

如果某一站没找到，明确说“未找到”，不要补猜测编号。

汽车之家输出时，如果当前拿到的是口碑链路结果，优先给 `seriesId`，不要把 `specId` 冒充成汽车之家 `seriesId`。

## 适合的用户说法

出现下面这类需求时，用本 skill：

- 帮我查一下某车型在汽车之家和懂车帝的编号
- 我说一个车型，你帮我找到汽车之家 / 懂车帝 URL 里的数字 ID
- 先帮我定位车型页，再做口碑采集
- 我只知道车型名，不知道 seriesId
- 查某车在汽车之家和懂车帝的链接编号

## 附带脚本

### `scripts/find_vehicle_ids_playwright.js`

用途：
- 用浏览器方式打开搜索页和车型页
- 输入车型名
- 输出汽车之家与懂车帝的车型编号和链接
- 对候选车型页做二次校验，避免拿错车
- 支持通过 `PLAYWRIGHT_PROXY_SERVER` 或 `HTTP_PROXY/HTTPS_PROXY` 走代理

示例：

```bash
node skills/vehicle-id-finder/scripts/find_vehicle_ids_playwright.js --json "风云X3PLUS"
```

### `scripts/find_vehicle_ids.py`

用途：
- 轻量 HTTP 原型版
- 用于快速试验、调规则
- 稳定性低于 Playwright 版，不建议作为正式结果唯一依据

## 注意

- 正式使用时优先跑 Playwright 版，不要只信搜索页第一条
- 站点搜索结构可能变，脚本失效时优先修脚本
- 不要把“搜索结果页里的任意数字”当成车型编号
- 不要因为车型名相近就自动把一个车系当成另一个车系
- 面对 `PLUS / PRO / MAX / EV / DM` 这类后缀时，宁可保守也别瞎对号入座
- 如果浏览器报网络/隧道错误，优先检查当前环境代理配置，而不是误判为站点无结果
- 汽车之家口碑链路里，`seriesId` 和 `specId` 不是一回事；当前 skill 面向口碑采集时要的是 `seriesId`
- 如果只命中汽车之家 `spec` 页，最多说明“车型命中了”，还不能直接宣布已拿到 `seriesId`
- 对汽车之家 `seriesId`，默认做一次 `k.autohome.com.cn/<seriesId>?dimensionid=10...` 直链确认再输出
