# 贡献指南

这个仓库只有一条铁律：**README.md 和 docs/index.html 是生成物，不要手改。**
所有内容都来自 `data/sites.json`，改完跑一遍脚本即可。

## 加一个新站点

1. 在 `data/sites.json` 的 `sites` 数组里追加一条：

```jsonc
{
  "id": "example",                       // 唯一标识，会用在 Codex provider 名里
  "name": "Example",
  "subtitle": "一句话卖点",
  "recommended": false,                  // true 会被标成「首推」
  "panel": "newapi",                     // 面板类型，不填即 newapi，另有 vibecode / matrix，见下文
  "credits": {                           // 额度口径，页面上的「首日可得」由它算出来
    "signup": 100,                       // 注册基础额度
    "invite": 50,                        // 通过本仓库邀请链接额外到账，站点接口没有就填 null
    "dailyCheckin": 25,                  // 每日签到额度（累积），没有签到就填 null
    "dailyQuota": null,                  // 每日重置的额度池（不累积），与 dailyCheckin 二选一
    "approx": false,                     // true 时页面显示 ≈，表示站点公示的是约数
    "unit": "usd"                        // 计价单位，不填即 usd；发站内积分的站填 "point"；
                                         // 也写「刀」但充值比例离谱的站（DoCode 1 元 = 50 刀）填 "site-usd"，见下文
  },
  "signupUrl": "https://example.com/register?aff=xxx",
  "inviteCode": "xxx",                   // 只在「注册表单里有一栏邀请码要手填」时写；
                                         // 写了才会在 README 总表末尾出「邀请码」列，没有站需要手填就不出这一列
  "homeUrl": "https://example.com",
  "docsUrl": "https://example.com/docs",
  "statusApi": "https://example.com/api/status",   // New API / One API 系都有
  "pricingApi": "https://example.com/api/pricing", // 需登录就填 null
  "mirrors": [{ "label": "备用域名", "homeUrl": "...", "signupUrl": "..." }],
  "tags": ["公益站", "免费额度"],
  "highlights": ["卖点一", "卖点二"],
  "endpoints": {
    "anthropic": "https://example.com",     // Claude Code 用，末尾不要 /v1
    "openai": "https://example.com/v1"      // Codex / SDK 用
  },
  // endpoints 都是 null（Base URL 要登录后台才下发）时，用 setup 写清怎么接入，
  // 页面会用它替换掉示例配置代码块——不要凭猜测填一个 Base URL 上去
  "setup": {
    "client": "Codex CLI",
    "note": "一句话说明为什么本页不给 Base URL",
    "steps": ["第一步", "第二步"],
    "dashboardUrl": "https://example.com/dashboard"
  },
  "modelsNote": "该站不公示模型清单时，写一句解释替代模型表",
  "register": { "methods": ["GitHub OAuth"], "requirements": ["注意事项"] },
  "earnMore": ["每日签到"],
  "caveats": ["风险提示"],
  "community": []
}
```

2. 本地预览并自检：

```bash
npm test          # 单测：抓取失败时的合并逻辑（不联网）
npm run refresh   # 抓 /api/status 与 /api/pricing，写入 data/live.json（只供本地预览）
npm run build     # 重新生成 README 与 docs/
npm run check     # 确认新链接可访问
```

3. 提交 `data/sites.json` 与 `data/locales/*.json` 就够了，`data/live.json` 不用带。
   推送到 main 后 CI 会立刻重新探测，生成并提交 `live.json` 与全部页面，新站的「新收录」事件和 Release 也由 CI 发出。

   **从 fork 提 PR 时只放源文件**，`README*.md`、`docs/`、`data/live.json` 一律别带：CI 每 6 小时就重写一遍它们，
   带上的 PR 几小时内必冲突（#16 就是这样）。PR 会自动跑 `npm test` 和 `npm run build`（[test.yml](.github/workflows/test.yml)），
   漏了哪份译文、字段写错了，合并前就能看到。

   > 本机网络和 GitHub Actions 不一样：有的站国内直连不通（`t.me`、`docode.cc`），有的只有走代理才通，
   > 本地 refresh 测出来的在线状态不可信。所以可用性历史与变动日志只由 CI 写入，`npm run history` 在本地默认什么都不做；
   > 比对基线也只认 CI 攒下的历史样本，就算误把本地的 `live.json` 一起提交，也不会再发出「XX 恢复在线」这类假消息
   > （2026-09-30 加 Conduit 时就这么翻过车，详见 `scripts/lib/history.mjs` 的 `ciBaseline`）。

## 归档不可用站点

在对应站点添加 `"archived": { "at": "2026-09-21", "reason": "归档依据" }`，不要删除源数据。
`at` 是归档日期；自动探测被 WAF 拦截不等于域名失效，原因应写人工确认或用户反馈的事实。
归档站只出现在 README 与首页历史区，不参与额度合计、横评、当前可用性、sitemap、快速配置或定时探测。
原详情地址会生成带 `noindex` 的归档说明页，历史事件和历史样本仍保留。
确认恢复可用后移除 `archived`，再运行刷新与构建；保留的旧额度需重新核对。

## 非数值权益与邀请路径

- 像 Mirasim 这样免费使用工作台、但模型需自带 Key 或付费订阅的站点，额度填 `null`，用
  `credits.note` 写清免费范围；不能把订阅价格或有条件的赠月算成首日 API 额度。
- 付费套餐用独立的 `subscription` 登记：`name`、`monthlyUsd`、`listMonthlyUsd`、`windowHours`、
  `estimates: [{ model, requests }]`、`sourceUrl`、`verifiedAt`。总表、卡片、详情与横评会展示月费和
  每个时间窗口的官网用量估算；共享额度的各模型次数不能相加，也不外推每天 / 每月保证量。
- `signupUrl` 始终保留用户提供的完整邀请链接。如果 robots 禁止自动抓取邀请路径，增加
  `signupProbeUrl` 指向允许抓取的公开入口。刷新和健康检查只探测后者，在线不表示邀请权益已实测。
- `endpoints` 没有已核实的公开地址就填 `null`，用 `setup` 说明客户端接入方式。
- 可用 `faq: [["问题", "答案"]]` 覆盖通用 FAQ，避免把「注册即送」套用到订阅活动。

## 站点不是 New API 面板怎么办

`panel` 字段选探测方式，路由表在 [`scripts/lib/panels.mjs`](scripts/lib/panels.mjs)：

| panel | 适用站点 | 读的接口 |
| --- | --- | --- |
| `newapi`（默认） | New API / One API 系 | `/api/status` + `/api/pricing` |
| `vibecode` | RawChat 系 Codex 公益站 | `/frontend-api/getConfig` + `/frontend-api/getLoginConfig` |
| `matrix` | Matrix（统一网关 + 应用商店） | `/api/health`（公开的只有这一个，站名 / 模型 / 网关地址都要登录） |
| `relay` | 自研网关 / 任务制积分站（CheapCodex、NOFX） | robots 放行的任意一个「还活着」URL：CheapCodex 探 `/v1/models`（不带 key 回 401 就算活着），NOFX 探 `sitemap.xml`。这两家的 robots.txt 直接禁掉 `/api`，面板接口一律不碰 |

`statusApi` 这个字段名是历史包袱：`relay` 面板下它不必是「状态接口」，填 robots 允许抓、
且能代表站点活着的任意一个 URL 即可，`probeRelay` 只回答「还活着吗、多久答话」。

新增一种面板：在 `scripts/lib/` 下写一个 `probeXxx(site, get = fetchJson)`，
返回值必须是 `blankSnapshot()` 的字段集合（多一个少一个都不行，`merge.mjs` 和渲染器按字段取数），
然后登记到 `PANELS` 里，并在 `scripts/test.mjs` 里贴一份真实返回体做断言——
参考 [`scripts/lib/vibecode.mjs`](scripts/lib/vibecode.mjs)，那里也顺手记下了这类站点
「额度 / Base URL 只有登录后才下发」这一事实，公开接口拿不到的东西一律不猜。
最省的例子是 [`scripts/lib/matrix.mjs`](scripts/lib/matrix.mjs)：那个站公开的只有一个健康检查，
于是探测就只据实回答「还活着吗、多久答话」，其余字段全留 null，绝不把 `sites.json` 里的登记值
倒灌进 `live.json` 假装是探测结果。比它还省的是 [`scripts/lib/relay.mjs`](scripts/lib/relay.mjs)：
连健康检查都没有，只能拿一个 robots 放行的 URL 判存活；它默认注入的是 `probeUrl` 而不是
`fetchJson`，因为 `fetchJson` 会把预期之内的 401 当失败连打三次，每 6 小时探一次的东西
没理由一次敲三下人家的门。

## 改版式 / 改文案

### 多语言版本

保留中文主版，增加 `en`、`hi`、`pt-BR`、`ja`、`de` 五种语言。顶部语言链接
在站点详情页会切换到同一站点，不会强制按浏览器语言跳转。README 入口为根目录的
`README.<locale>.md`，网页入口为 `docs/<locale>/`。

- 选语种的依据与局限见 [多语言说明](I18N.md)，不是 GitHub 官方自然语言排行榜。
- `data/locales/*.json` 是手工维护的翻译来源，包含界面文字和站点摘要、注册条件、重要风险。
  新增站点或修改政策时，同步更新五份文案；英文是键名和占位符的校验基准，不是静默回退语言。
- 金额、模型、协议入口、完整邀请 URL、位次均来自 `data/sites.json` / `data/live.json`，
  翻译不要复制这些可生成字段。像 `{inviteCode}` 的占位符不可改名或遗漏。
- `scripts/lib/render-localized.mjs` 生成翻译版 README、首页、详情页；共享 `credits.mjs`
  与 `signup.mjs` 的计算逻辑。历史、横评、外部文档仍为原语言，入口明确标注中文。
- 归档时各语言的旧详情页都会覆盖为 `noindex` 说明页，不保留注册链接，也不进入 sitemap。
- `npm test && npm run build` 校验完整性并重新生成。CI 自动刷新同时提交所有 README 语言版。

### 中文版与公共数据

- README 的结构在 [`scripts/lib/render-readme.mjs`](scripts/lib/render-readme.mjs)
- 落地页结构在 [`scripts/lib/render-html.mjs`](scripts/lib/render-html.mjs)，样式在 [`docs/assets/style.css`](docs/assets/style.css)（这个是手写文件，可以直接改）
- 抓取字段的解析在 [`scripts/lib/newapi.mjs`](scripts/lib/newapi.mjs)（同时是各面板共用的底座：`fetchJson` / `blankSnapshot` / `pickPreferred`）
- 额度口径在 [`scripts/lib/credits.mjs`](scripts/lib/credits.mjs)：站点接口只暴露邀请额度，注册基础额度和签到额度是站内公示、只能手工登记在 `credits` 里；`npm run build` 会拿登记值和接口实测值对账，不一致就告警，看到告警就去更新 `data/sites.json`。注意区分两种「每日」——`dailyCheckin` 是签到领到手、会累积；`dailyQuota` 是每天重置的额度池，用不完清零，文案上一律写「重置 / 不累积」，别混着说。还要注意计价单位：`credits.unit` 不填即美元，发站内积分的站（如 Matrix）填 `"point"`，页面会按「600 积分」显示；跨站合计（「首日最高」「全注册约多少」）只统计美元站，积分站单独说一句——积分与美元没有公开换算，加在一起就是编数字。写「刀」但那个刀不是美元的站填 `"site-usd"`（如 DoCode：面板的 `price` 字段是充值比例，多数站 7.3 即 ¥7.3 ≈ $1，它是 0.02 即 1 元 = 50 刀，扣费还要再乘 7~14 倍的站内倍率）——判据就是 `/api/status` 的 `price` 与 `quota_per_unit`，和 7.3 差一个数量级的一律按站内单位登记，页面显示「300 站内刀」并排除在美元合计之外。新增单位要同时补 `credits.mjs` 里的 `UNITS`，否则只会原样后缀显示并在 build 时告警。
- 抓取失败时的降级策略在 [`scripts/lib/merge.mjs`](scripts/lib/merge.mjs)：内容字段沿用上一次成功的快照，`online` 以注册页能否访问为准（接口被 Cloudflare 拦不等于站点挂了）；连注册页也被拦（403 / 429 / 503 / 挑战页）时按「机房 IP 被 WAF 拦」处理——沿用上次的在线判定并标 `probeBlocked`，页面上写明数据是哪次快照的。超时 / 连不上 / 502 这类信号才算真下线；上次成功探测超过 48 小时也不再兜底，如实标异常。改这里请一并跑 `npm test`。

改完同样跑 `npm run build`，把生成物一起提交，CI 才不会又把它刷回去。

## 收录标准

- 能**免费**拿到额度，注册流程不强制付费、不套娃
- 有可探测的公开接口（能自动更新的站点才好长期维护）
- 不收录纯付费中转、需要邀请码倒卖的站点

## 第一次推到 GitHub

1. 把 `data/sites.json` 里 `meta.repoUrl` / `meta.pagesUrl` 换成你自己的用户名，重新 `npm run build`。
2. 建好空仓库后推上去：

```bash
git remote add origin https://github.com/panxunying/ai-coding-welfare.git
git branch -M main
git push -u origin main
```

3. 仓库 Settings → Pages → Source 选 **Deploy from a branch**，分支 `main`、目录 `/docs`，保存后落地页就上线了。
4. Settings → Actions → General → Workflow permissions 勾 **Read and write permissions**，否则定时刷新的自动提交会被拒。
5. 仓库简介与 Topics 建议填上 `claude-code`、`codex`、`free-api`、`new-api` 之类的关键词，这是 GitHub 站内搜索的主要抓手。

## 一点分寸

推广页面写实话就够了：额度、门槛、限制照抄站点公示，不夸大、不承诺稳定性。
公益站是别人自掏腰包做的，别引导批量注册和刷额度——把站刷没了大家都用不上。
