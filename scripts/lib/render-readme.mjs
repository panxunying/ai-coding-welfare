/** 生成 README.md：全部内容由 data/sites.json + data/live.json 渲染，请勿手改 README。 */
import { staleHours } from './newapi.mjs';
import { creditPlan, usd, breakdown, perDay, usdTotals, othersNote } from './credits.mjs';
import { signupRoute, acceptsNew } from './signup.mjs';
import { icon } from './changelog.mjs';
import { coverage } from './history.mjs';
import { activeSites, archivedSites, archivedAt, archivedReason } from './archived.mjs';
import { subscriptionPlan } from './subscription.mjs';
import { readmeLanguages } from './locales.mjs';
import { esc } from './layout.mjs';

/** shields.io 转义：- → --，_ → __，其余走 URI 编码 */
const shield = (s) => encodeURIComponent(String(s).replace(/-/g, '--').replace(/_/g, '__'));
const B = (label, msg, color) => `https://img.shields.io/badge/${shield(label)}-${shield(msg)}-${color}`;

const yes = (v) => (v === true ? '✅' : v === false ? '❌' : '—');

function fmtDate(iso) {
  if (!iso) return '未知';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** 挑一个用于示例配置的 Claude 模型名 */
function claudeModel(snap) {
  return snap?.defaults?.claude ?? '<登录后台查看可用模型名>';
}

/** 挑一个用于示例配置的 OpenAI 协议模型名 */
function openaiModel(snap) {
  return snap?.defaults?.openai ?? '<登录后台查看可用模型名>';
}

function overviewTable(sites, liveById) {
  // 多数站的邀请额度是邀请链接自己带的，用户不用手打；只有个别站（DoCode）注册表单里
  // 有一栏「邀请码」要自己填，漏填就只拿注册额度。没有任何站需要手填时不出这一列。
  const hasCode = sites.some((s) => s.inviteCode);
  const hasSubscription = sites.some((s) => s.subscription);
  const rows = sites.map((s) => {
    const l = liveById.get(s.id) ?? {};
    const plan = creditPlan(s, l);
    const sub = subscriptionPlan(s);
    const route = signupRoute(l);
    // 「在线」和「收不收新用户」是两件事：站点活得好好的但停注了，对新用户就是死路，
    // 状态栏必须说出来，否则下面那个「首日可得 $120」是在骗人点链接
    const state = l.online ? (route.state === 'closed' ? '🟡 停注' : '🟢 在线') : '🔴 异常';
    const first =
      sub
        ? `${route.state === 'closed' ? `~~${sub.label}~~` : `**${sub.label}**`}${sub.listPrice ? `<br>标价 ${sub.listPrice}` : ''}`
        : plan.firstDay != null
        ? route.state === 'closed'
          ? `~~${usd(plan.firstDay, plan.approx, plan.unit)}~~`
          : `**${usd(plan.firstDay, plan.approx, plan.unit)}**`
        : plan.note ?? '站内公示';
    const detail = sub ? sub.estimates.map((e) => `${e.model} **${e.amount}**`).join('<br>') : breakdown(plan) ?? '—';
    const checkin =
      sub ? `**${sub.window}**<br>共享额度` : perDay(plan) ??
      (l.checkinEnabled
        ? '支持签到'
        : l.checkinEnabled === false
          ? '无签到'
          : '—');
    const models = sub ? `${sub.estimates.length} 种<br>官网公示`
      : l.models?.length ? `${l.models.length} 个可查`
      : s.modelsSummary ? `**${esc(s.modelsSummary).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')}**`
      : l.services?.length ? l.services.join(' / ') : '需登录查看';
    const proto =
      [s.endpoints?.anthropic && 'Anthropic', s.endpoints?.openai && 'OpenAI'].filter(Boolean).join(' + ') ||
      s.setup?.client ||
      '登录后台配置';
    const cta =
      route.state === 'closed'
        ? `[已停注 · 仍可打开 →](${s.signupUrl})`
        : sub ? `[查看 ${sub.name} →](${s.signupUrl})` : route.state === 'oauth'
          ? `[${route.oauth[0]} 注册 →](${s.signupUrl})`
          : `[点此注册 →](${s.signupUrl})`;
    const code = s.inviteCode ? ` \`${s.inviteCode}\` |` : ' — |';
    return (
      `| **${s.name}**${s.recommended ? ' 🔥' : ''} | ${state} | ${first} | ${detail} | ${checkin} | ${proto} | ${models} | ${cta} |` +
      (hasCode ? code : '')
    );
  });
  return [
    `| 站点 | 状态 | ${hasSubscription ? '首日可得 / 套餐' : '首日可得'} | ${hasSubscription ? '额度构成 / 用量' : '额度构成'} | ${hasSubscription ? '每日 / 周期' : '之后每天'} | 兼容协议 | 模型 | 注册 |${hasCode ? ' 邀请码 |' : ''}`,
    `| :-- | :--: | :--: | :-- | :--: | :--: | :--: | :--: |${hasCode ? ' :--: |' : ''}`,
    ...rows,
  ].join('\n');
}

function modelTable(snap) {
  if (!snap?.models?.length) return null;
  const rows = snap.models.map((m) => {
    // 按次计费的模型（New API 的 model_price）没有倍率概念，倍率栏照抄接口的 0 会被读成「免费」，
    // 真正有用的是每次多少钱，所以这类模型把价格放到输入列、倍率列写「按次」。
    const fixed = m.fixedPrice != null;
    const ratio = fixed ? '按次' : (m.ratio ?? '—');
    const inp = fixed ? `**$${m.fixedPrice} / 次**` : m.inputPerMTok != null ? `$${m.inputPerMTok}` : '—';
    const out = fixed ? '—' : m.outputPerMTok != null ? `$${m.outputPerMTok}` : '—';
    return `| \`${m.name}\` | ${ratio} | ${inp} | ${out} | ${(m.protocols ?? []).join(' / ') || '—'} |`;
  });
  return [
    '| 模型 | 倍率 | 输入 / 1M tokens | 输出 / 1M tokens | 协议 |',
    '| :-- | :--: | :--: | :--: | :--: |',
    ...rows,
  ].join('\n');
}

function liveFacts(snap) {
  if (!snap) return '_暂无实时数据_';
  const items = [
    staleHours(snap) ? `⚠ 接口已连续 ${staleHours(snap)} 小时没抓到新数据，下列信息为 \`${fmtDate(snap.staleFrom)}\` 的快照` : null,
    snap.probeBlocked ? `ℹ️ 本次自动探测被站点 WAF 拦下（GitHub Actions 机房 IP 常见，家宽访问不受影响），状态与下列信息沿用 \`${fmtDate(snap.staleFrom ?? snap.checkedAt)}\` 的成功快照` : null,
    // 站名 / 版本不是每种面板都拿得到（Matrix 只有一个健康检查），拿不到就别摆一行「—」占位
    snap.systemName ? `站点名称：**${snap.systemName}**` : null,
    snap.version ? `面板版本：\`${snap.version}\`` : null,
    snap.services?.length ? `已开放服务：${snap.services.join(' / ')}` : null,
    snap.inviterBonusUsd ? `邀请他人可得：**$${snap.inviterBonusUsd}**` : null,
    snap.checkinEnabled != null ? `每日签到：${yes(snap.checkinEnabled)}` : null,
    snap.registerOpen != null ? `开放注册：${yes(snap.registerOpen)}${signupRoute(snap).note ? `（${signupRoute(snap).note}）` : ''}` : null,
    snap.loginMethods?.length ? `登录方式：${snap.loginMethods.join(' / ')}` : null,
    snap.githubMinAccountAgeDays ? `GitHub 账号需满 **${snap.githubMinAccountAgeDays} 天**` : null,
    snap.latencyMs != null ? `接口延迟：${snap.latencyMs} ms` : null,
  ].filter(Boolean);
  return items.map((t) => `- ${t}`).join('\n');
}

/** 额度明细：接口只给邀请额度，注册基础额度与签到额度来自 sites.json 登记 */
function creditFacts(site, snap) {
  const p = creditPlan(site, snap);
  const sub = subscriptionPlan(site);
  if (sub) return [
    `- **${sub.label}**${sub.listPrice ? `（官网标价 ${sub.listPrice}）` : ''}`,
    `- **${sub.window}**的请求量参考，不是整月总次数：`,
    '',
    '| 模型 | 官网估算请求量 |',
    '| :-- | --: |',
    ...sub.estimates.map((e) => `| ${e.model} | **${e.amount}** |`),
    '',
    `> ${sub.note} 这是付费套餐，不计入免费额度合计。[来源：官网定价](${sub.sourceUrl})（${sub.verifiedAt} 核对）。`,
    ...(p.note ? ['', `另有免费路径：${p.note}，第三方 API 费用另算。`] : []),
  ].join('\n');
  if (p.firstDay == null) return p.note ? `- 免费范围：${p.note}` : null;
  const detail = breakdown(p);
  return [
    p.signup != null ? `- 注册即送：**${usd(p.signup, false, p.unit)}**` : null,
    p.invite != null
      ? `- 从本页邀请链接注册额外：**${usd(p.invite, false, p.unit)}**${p.apiInvite === p.invite ? '（站点接口实测一致）' : ''}`
      : null,
    p.daily == null
      ? null
      : p.resets
        ? `- 每日额度池：**${usd(p.daily, p.approx, p.unit)}/天**（每天重置，当天用不完不累积，也不用签到）`
        : `- 每日签到：**${usd(p.daily, p.approx, p.unit)}/天**（长期续命的关键）`,
    `- 首日合计：**${usd(p.firstDay, p.approx, p.unit)}**${p.sources > 1 && detail ? `　（${detail}）` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function siteSection(site, snap) {
  const cm = claudeModel(snap);
  const om = openaiModel(snap);
  const models = modelTable(snap);
  const mirror = (site.mirrors ?? [])
    .map((m) => `- ${m.label ?? '备用域名'}：<${m.homeUrl}> · [从备用域名注册](${m.signupUrl})`)
    .join('\n');

  const parts = [
    `### ${snap?.online ? '🟢' : '🔴'} ${site.name}${site.recommended ? ' 🔥 首推' : ''}`,
    '',
    `> ${site.subtitle}`,
    '',
    `<a href="${site.signupUrl}"><img src="${B('立即注册', site.name, 'brightgreen?style=for-the-badge')}" alt="注册 ${site.name}"></a>`,
    '',
    `**为什么值得注册**`,
    '',
    site.highlights.map((h) => `- ${h}`).join('\n'),
    ...(creditFacts(site, snap) ? ['', site.subscription ? '**套餐价格与用量**' : '**能拿多少额度**', '', creditFacts(site, snap)] : []),
    '',
    '**实时数据**（自动抓取站点公开接口）',
    '',
    liveFacts(snap),
  ];

  if (mirror) parts.push('', '**镜像 / 备用入口**', '', mirror);
  if (models) {
    const fixedAny = (snap?.models ?? []).some((m) => m.fixedPrice != null);
    const note = fixedAny
      ? '标「按次」的模型按请求次数计费，与 tokens 用量无关；其余倍率 1 ≈ $2 / 1M tokens。以站内实时价格为准。'
      : '倍率 1 ≈ $2 / 1M tokens，输出价 = 倍率 × 补全倍率 × $2；以站内实时价格为准。';
    parts.push('', '**当前可用模型**', '', models, '', `<sub>${note}</sub>`);
  } else parts.push('', `> ${site.modelsNote ?? '该站模型清单需登录后台查看，注册后在「模型价格」页确认。'}`);

  parts.push(
    '',
    '**注册要求**',
    '',
    [...(site.register?.requirements ?? []).map((r) => `- ${r}`)].join('\n') || '- 无特殊限制',
    '',
    '**接入配置**',
    '',
    accessBlock(site, cm, om),
  );

  if (site.earnMore?.length) parts.push('', '**如何继续拿额度**', '', site.earnMore.map((t) => `- ${t}`).join('\n'));
  if (site.caveats?.length) parts.push('', '**⚠️ 使用前必读**', '', site.caveats.map((t) => `- ${t}`).join('\n'));
  if (site.community?.length) parts.push('', '**官方渠道**', '', site.community.map((t) => `- ${t}`).join('\n'));

  const ann = (snap?.announcements ?? []).slice(0, 3);
  if (ann.length) {
    parts.push('', '<details><summary><b>站点最新公告</b>（自动同步）</summary>', '');
    parts.push(ann.map((a) => `- ${a.date ? `\`${a.date}\` ` : ''}${a.text}`).join('\n'));
    parts.push('', '</details>');
  }
  return parts.join('\n');
}

const F = '```';

/**
 * 有公开 Base URL 的站点直接给可抄的配置；
 * Codex 号池那类站点的 Base URL 与 Key 是后台登录后才下发的，只能写清楚去哪儿领，
 * 硬编一个猜出来的地址比不写更糟。
 */
function accessBlock(site, claude, openai) {
  if (site.endpoints?.anthropic || site.endpoints?.openai) return codeBlocks(site, claude, openai);

  const s = site.setup ?? {};
  const out = [];
  if (s.note) out.push(`> ${s.note}`, '');
  if (s.steps?.length) out.push(s.steps.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  if (s.dashboardUrl) out.push('', `控制台入口：<${s.dashboardUrl}>`);
  return out.join('\n') || '> 注册登录后在站内后台查看接入方式。';
}

function codeBlocks(site, claude, openai) {
  const anth = site.endpoints?.anthropic;
  const oai = site.endpoints?.openai;
  const out = [];

  if (anth) {
    out.push(
      '<details open><summary><b>Claude Code</b>（Anthropic 兼容，Base URL 不带 <code>/v1</code>）</summary>',
      '',
      `${F}bash`,
      '# macOS / Linux',
      `export ANTHROPIC_BASE_URL=${anth}`,
      'export ANTHROPIC_AUTH_TOKEN=你在站点后台创建的 Key',
      `export ANTHROPIC_MODEL=${claude}`,
      'npm install -g @anthropic-ai/claude-code@latest && claude',
      F,
      '',
      `${F}powershell`,
      '# Windows PowerShell',
      `$env:ANTHROPIC_BASE_URL = "${anth}"`,
      '$env:ANTHROPIC_AUTH_TOKEN = "你在站点后台创建的 Key"',
      `$env:ANTHROPIC_MODEL = "${claude}"`,
      'claude',
      F,
      '',
      '</details>',
      '',
    );
  }

  if (oai) {
    out.push(
      '<details><summary><b>Codex CLI</b>（OpenAI 兼容，写入 <code>~/.codex/config.toml</code>）</summary>',
      '',
      `${F}toml`,
      `model = "${openai}"`,
      `model_provider = "${site.id}"`,
      '',
      `[model_providers.${site.id}]`,
      `name = "${site.name}"`,
      `base_url = "${oai}"`,
      `env_key = "${site.id.toUpperCase()}_API_KEY"`,
      'wire_api = "chat"',
      F,
      '',
      '</details>',
      '',
      '<details><summary><b>OpenAI SDK / Cherry Studio / Cursor 等通用客户端</b></summary>',
      '',
      `${F}python`,
      'from openai import OpenAI',
      '',
      `client = OpenAI(api_key="你的 Key", base_url="${oai}")`,
      `resp = client.chat.completions.create(model="${openai}", messages=[{"role": "user", "content": "ping"}])`,
      'print(resp.choices[0].message.content)',
      F,
      '',
      '通用客户端只需填两项：**Base URL** = `' + oai + '`，**API Key** = 站点后台创建的 Key。',
      '',
      '</details>',
      '',
      '<details><summary><b>连通性自测</b></summary>',
      '',
      `${F}bash`,
      `curl -s ${oai}/chat/completions \\`,
      '  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\',
      `  -d '{"model":"${openai}","messages":[{"role":"user","content":"只回复 OK"}]}'`,
      F,
      '',
      '</details>',
    );
  }
  return out.join('\n');
}

/**
 * 首屏投稿公告：Issue 区对所有访客公开，投稿本身就是一次推广；特别优质的再人工收录进正文。
 * 用 GitHub 的 [!TIP] 提示块，是 README 里最醒目的写法。提交入口给模板选择页而不是直接进表单：
 * 投站点有现成表单，想推广别的东西也能开空白 Issue。
 */
function submitCallout(repoUrl) {
  return [
    '> [!TIP]',
    '> **📣 欢迎投稿：Issue 区就是你的免费推广位**',
    '>',
    `> 发现好用的福利站，或者自己就在运营一个？直接[提交 Issue](${repoUrl}/issues/new/choose)，邀请链接可以一并贴上。` +
      'Issue 对所有访客公开，本身就是推广渠道；其中特别优质、实测靠谱的，我会收录进正文。' +
      `想发现更多站点，不妨[逛逛 Issue 区](${repoUrl}/issues)。`,
  ];
}

export function renderReadme({ meta, sites: allSites, live, groups = [], history }) {
  // 挂掉的站点不进主列表与任何合计，只进底部「历史挂掉的站点」——死了的站不许再吆喝额度
  const sites = activeSites(allSites);
  const dead = archivedSites(allSites);
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  const onlineCount = sites.filter((s) => byId.get(s.id)?.online).length;
  const staleCount = sites.filter((s) => staleHours(byId.get(s.id))).length;
  // 「全注册一遍能拿多少」这句话是对新用户说的，把停注的站点算进去就是虚报额度（详见 lib/signup.mjs）
  const openSites = sites.filter((s) => acceptsNew(byId.get(s.id)));
  const closedSites = sites.filter((s) => !acceptsNew(byId.get(s.id)));
  const plans = openSites.map((s) => creditPlan(s, byId.get(s.id)));
  // 合计只算美元站：积分与美元没有公开换算，混着加就是编数字（详见 lib/credits.mjs）
  const { count: usdCount, best, total, resetting, others } = usdTotals(plans);
  const codeSites = sites.filter((s) => s.inviteCode);
  const extra = othersNote(others);
  const scope = `${usdCount} 个有明确美元额度、且还收新用户的站`;
  const pages = (meta.pagesUrl ?? '').replace(/\/?$/, '/');
  const repoName = String(meta.repoUrl ?? '').replace(/\/+$/, '').split('/').pop();

  const head = [
    `<h1 align="center">${meta.title}</h1>`,
    '',
    readmeLanguages(),
    '',
    `<p align="center">${meta.tagline}</p>`,
    '',
    '<p align="center">',
    `  <img src="${B('收录站点', `${sites.length} 个`, 'blue')}" alt="收录站点">`,
    `  <img src="${B('在线', `${onlineCount}/${sites.length}`, onlineCount === sites.length ? 'brightgreen' : 'orange')}" alt="在线">`,
    closedSites.length
      ? `  <img src="${B('可注册', `${openSites.length}/${sites.length}`, 'yellow')}" alt="可注册">`
      : null,
    best > 0 ? `  <img src="${B('首日可得', `最高 $${best}`, 'success')}" alt="首日可得">` : null,
    `  <img src="${B('数据更新', fmtDate(live?.generatedAt).replace(/:/g, '.'), 'informational')}" alt="数据更新">`,
    '</p>',
    '',
    '<p align="center">',
    sites.map((s) => `  <a href="${s.signupUrl}"><b>${s.name} 注册</b></a>`).join(' ·\n'),
    '</p>',
    '',
    `<p align="center"><a href="${pages}compare/">📊 按次 vs 按量折算横评</a> · <a href="${pages}status/">🩺 可用性历史</a> · <a href="${pages}changelog/">🗓 变动日志</a> · <a href="${pages}feed.xml">🔔 Atom 订阅</a></p>`,
    '',
    ...submitCallout(meta.repoUrl),
    '',
    '---',
    '',
    '## 🚀 一分钟上车',
    '',
    overviewTable(sites, byId),
    ...sites.filter((s) => s.subscription).flatMap((s) => {
      const sub = subscriptionPlan(s);
      return ['', `> **${s.name} ${sub.label}：用量按${sub.window}估算，不是每月总次数。** ${sub.note} 付费套餐不计入下方免费额度合计。[官网定价](${sub.sourceUrl})（${sub.verifiedAt} 核对）。`];
    }),
    '',
    `> 「首日可得」= 注册基础额度 + 本页邀请链接额度 + 当天能领的签到额度（每日重置额度池的站点按一天的池子算）；模型、价格、在线状态由脚本抓取站点公开接口自动生成，最后更新：\`${fmtDate(live?.generatedAt)}\`。`,
    codeSites.length ? '>' : null,
    // 「—」不等于没有邀请额度，只是不用手打；这一句不写清楚，读者会以为那些站白嫖不到邀请额度
    codeSites.length
      ? `> 「邀请码」列写了码的站（${codeSites
          .map((s) => `${s.name} \`${s.inviteCode}\``)
          .join('、')}），注册表单里有一栏要**自己填**，漏填就只拿得到注册基础额度、事后补不上；其余站写 — 表示未登记需要手填的邀请码，邀请奖励与条件请看站点详情。`
      : null,
    total > 0 ? '>' : null,
    total > 0
      ? `> ${scope}全注册一遍，第一天手上大约有 **$${total}** 额度可用${resetting ? '（其中每日重置的额度池次日会回满，但不累积）' : ''}${
          extra ? `；${extra}，都是各站自己的计价单位、与美元没有公开换算，未计入这个合计` : ''
        }。`
      : null,
    closedSites.length ? '>' : null,
    closedSites.length
      ? `> 🟡 ${closedSites
          .map((s) => `**${s.name}**`)
          .join('、')} 的接口自报已关闭新用户注册（\`register_enabled=false\`），表里额度已划掉、也没算进上面的合计；站点本身还在跑，老用户不受影响，重新开放会记进[变动日志](${pages}changelog/)。`
      : null,
    staleCount > 0 ? '>' : null,
    staleCount > 0
      ? `> 🟡 有 ${staleCount} 个站点已超过 48 小时没抓到接口数据，其明细为上一次成功抓取的快照；在线状态按注册页实际可访问性判断。`
      : null,
    '',
    '**只想快点用上 Claude Code？** 三步：',
    '',
    `1. 点上表的注册链接 → 按站点支持的方式登录（GitHub / 邮箱），额度是按邀请链接发放的，别走裸链`,
    '2. 后台「令牌 / API Keys」新建一个 Key',
    '3. 跑一键脚本，或手抄下面对应站点的环境变量',
    '',
    // 在 GitHub 上看 README 的人手里没有这个仓库，光写 bash scripts/quickstart.sh 是跑不起来的
    `${F}bash`,
    '# 交互式写好 Claude Code 的环境变量（macOS / Linux，需要 Node.js）',
    `git clone --depth 1 ${meta.repoUrl}.git && cd ${repoName}`,
    'bash scripts/quickstart.sh',
    F,
    '',
    `${F}powershell`,
    '# Windows PowerShell（5.1 不认 &&，两条命令用 ; 隔开）',
    `git clone --depth 1 ${meta.repoUrl}.git; cd ${repoName}`,
    'powershell -ExecutionPolicy Bypass -File scripts/quickstart.ps1',
    F,
    '',
    '## 📚 站点详情',
    '',
  ];

  const body = sites.map((s) => siteSection(s, byId.get(s.id))).join('\n\n---\n\n');
  return [
    head.filter((l) => l !== null).join('\n'),
    body,
    graveyardBlock(dead, pages),
    changesBlock({ groups, history, pages }),
    tail(meta, sites, live),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 「历史挂掉的站点」：曾经收录、现已确认挂掉的站。只记名与死因，不再给注册链接 */
function graveyardBlock(dead, pages) {
  if (!dead.length) return null;
  const lines = dead.map((s) => {
    const when = archivedAt(s);
    return `- **${s.name}**${when ? `（\`${when}\` 归档）` : ''} — ${archivedReason(s)}`;
  });
  return [
    '---',
    '',
    '## 📦 历史区 · 已停用站点',
    '',
    `这些站已反馈不可用，保留名称与归档原因，不再推荐注册、展示额度或进行定时探测。历史记录仍可在[变动日志](${pages}changelog/)中查看；确认恢复可用后可人工重新收录。`,
    '',
    ...lines,
  ].join('\n');
}

/**
 * 「最近变动 + 怎么订阅」。
 *
 * 导航类仓库最大的问题是没人会来第二次：给出 Watch → Releases 和 Atom 两个出口，
 * 让 CI 主动把变动推到用户面前，而不是等用户回来刷 README。
 */
function changesBlock({ groups, history, pages }) {
  const events = groups.flatMap((g) => g.events).slice(0, 6);
  const cov = coverage(history ?? { samples: [] });
  const lines = [
    '---',
    '',
    '## 🔔 额度变了，这里会通知你',
    '',
    `CI 每 6 小时抓一次各站接口，与上一次快照逐字段比对${
      cov.samples ? `，目前已攒下 ${cov.samples} 个样本、覆盖约 ${cov.days} 天` : ''
    }。额度调整、掉线与恢复、模型上下线、价格变动都会自动记一条：`,
    '',
    '- 点仓库右上角 **Watch → Custom → Releases**：有重要变动时 GitHub 直接发邮件',
    `- 订阅 [Atom feed](${pages}feed.xml)：RSS 阅读器 / Feedly / Telegram 机器人都能读`,
    `- 在线看：[变动日志](${pages}changelog/) · [可用性历史](${pages}status/)`,
  ];
  if (events.length) {
    lines.push(
      '',
      '最近几条：',
      '',
      ...events.map((e) => `- \`${String(e.at ?? '').slice(0, 10)}\` ${icon(e.type)} ${e.text}`),
      '',
      '完整记录见 [CHANGELOG.md](CHANGELOG.md)。',
    );
  }
  return lines.join('\n');
}

function tail(meta, sites, live) {
  return [
    '---',
    '',
    '## 🧰 仓库里有什么',
    '',
    '| 文件 | 作用 |',
    '| :-- | :-- |',
    '| [`data/sites.json`](data/sites.json) | 唯一数据源：站点信息与推广链接 |',
    '| [`data/live.json`](data/live.json) | 自动抓取的实时快照（额度 / 模型 / 在线状态） |',
    '| [`data/history.json`](data/history.json) | 每 6 小时一个样本的可用性时间序列 |',
    '| [`data/changelog.json`](data/changelog.json) | 快照比对出来的变动事件流 |',
    '| [`scripts/refresh.mjs`](scripts/refresh.mjs) | 抓取站点公开接口 |',
    '| [`scripts/lib/merge.mjs`](scripts/lib/merge.mjs) | 抓取失败时沿用上次快照，页面不会被刷空 |',
    '| [`scripts/lib/credits.mjs`](scripts/lib/credits.mjs) | 额度口径：注册 + 邀请 + 签到 = 首日可得 |',
    '| [`scripts/lib/diff.mjs`](scripts/lib/diff.mjs) | 比对两份快照，只挑「影响值不值得注册」的变动 |',
    '| [`scripts/history.mjs`](scripts/history.mjs) | 归档历史 + 生成 CHANGELOG / Release / 推送素材 |',
    '| [`scripts/build.mjs`](scripts/build.mjs) | 用数据重新生成 README 与 docs/ 全站 |',
    '| [`scripts/notify.mjs`](scripts/notify.mjs) | 重要变动推到 Telegram（没配 secret 就跳过） |',
    '| [`scripts/check.mjs`](scripts/check.mjs) | 链接与站点健康检查，失效即 CI 报警 |',
    '| [`scripts/test.mjs`](scripts/test.mjs) | 合并逻辑与额度口径的单测（零依赖，`npm test`） |',
    '| [`scripts/quickstart.sh`](scripts/quickstart.sh) / [`.ps1`](scripts/quickstart.ps1) | 交互式配置 Claude Code 环境变量 |',
    '',
    '本地跑一遍：',
    '',
    `${F}bash`,
    'npm test          # 单测（不联网）',
    'npm run refresh   # 抓最新数据',
    'npm run history   # 归档历史 + 生成变动日志（只在 CI 里写入，本地默认跳过）',
    'npm run build     # 重新生成 README + docs/',
    'npm run check     # 校验链接是否还活着',
    F,
    '',
    '## ❓ 常见问题',
    '',
    '<details><summary><b>注册完为什么看不到额度？</b></summary>',
    '',
    '公益站的额度多在登录时结算，**退出登录再重新登录一次**通常就会到账；余额偶尔显示 $0 是前端展示问题，稍后刷新即可。',
    '',
    '</details>',
    '',
    '<details><summary><b>Claude Code 报 401 / Unauthorized？</b></summary>',
    '',
    '按顺序排查：Base URL 是否误加了 `/v1`（Anthropic 协议不要加）、Key 是否复制完整、模型名是否在站内可用清单里、当前客户端是否属于该站支持的客户端。',
    '',
    '</details>',
    '',
    '<details><summary><b>请求返回 400 content blocked？</b></summary>',
    '',
    '部分站点只放行中 / 英 / 法 / 德 / 俄，提示词里混入其它语言会被上游拦截，换语言重试即可。',
    '',
    '</details>',
    '',
    '<details><summary><b>之前登录过 Claude Pro / Max，切过来会冲突吗？</b></summary>',
    '',
    '会。环境变量优先级高于订阅登录，想切回官方订阅就 `unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL` 后重开终端。',
    '',
    '</details>',
    '',
    tailFooter(meta, sites),
  ].join('\n');
}

function tailFooter(meta, sites) {
  return [
    '## 🤝 收录新的福利站',
    '',
    '发现好用的公益站 / 中转站？两种方式：',
    '',
    `- 提 [Issue](${meta.repoUrl}/issues/new?template=new-site.yml) 填个表单：投稿公开可见，本身就是一次推广；符合下方收录标准、特别优质的，我会收录进正文`,
    '- 或者直接 PR：往 `data/sites.json` 加一条、五份 `data/locales/*.json` 补上译文，`npm test` 通过后提交；README、`docs/`、`data/live.json` 是生成物，别带进 PR（CI 每 6 小时重写一次，带上必冲突），合并后会自动生成',
    '',
    '收录标准：**能免费拿到额度**、注册流程不套娃、站点公开接口可探测。',
    '',
    '## ⚠️ 免责声明',
    '',
    '- 本页包含**邀请链接**，邀请奖励、领取条件与免费范围以各站活动规则为准；不保证注册即有奖励。',
    '- 本仓库只做信息聚合，**与各站点无隶属关系**，不代收费用、不承诺可用性。公益站随时可能改规则、限速或关站。',
    '- Issue 区的投稿由网友自行发布，未经本仓库核实，注册前请自行甄别；只有收录进正文的站点才会被定时探测。',
    '- 请勿把生产密钥、隐私数据、企业代码丢给来源不明的中转服务；重要项目请用官方 API。',
    '- 请遵守各站点与上游模型服务商的使用条款，禁止批量注册、刷量、转售额度等行为，封号自负。',
    '- 页面上的额度 / 模型 / 价格由脚本自动抓取，仅代表抓取那一刻的状态，**一切以站内实时公示为准**。',
    '',
    '---',
    '',
    `<p align="center"><b>觉得有用点个 ⭐ Star</b>，福利站有变动时这里会自动更新。</p>`,
    '',
    `<sub>关键词：${(meta.keywords ?? []).join(' · ')}</sub>`,
    '',
    `<!-- 本文件由 scripts/build.mjs 自动生成，请修改 data/sites.json 或 scripts/lib/render-readme.mjs -->`,
  ].join('\n');
}
