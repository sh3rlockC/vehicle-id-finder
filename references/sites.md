# 站点编号规则

## 汽车之家

车型页常见格式：

- `https://www.autohome.com.cn/8089/`
- `https://www.autohome.com.cn/8089/#pvareaid=100125`

其中 `8089` 就是车型 `seriesId`。

## 懂车帝

车型页常见格式：

- `https://www.dongchedi.com/auto/series/25398`

其中 `25398` 就是车型 `seriesId`。

## 使用原则

- 优先返回可直接验证的车型页 URL + 编号
- 若搜索结果不唯一，保留候选项，避免瞎报
- 若站点搜索结构变化，优先修脚本，不要在 SKILL.md 里堆大量站点 HTML 细节
