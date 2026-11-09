/**
 * 三个辅助页：/compare/（计费方式横评）、/status/（可用性）、/changelog/（变动日志）。
 *
 * compare 是这堆页面里唯一带独立判断的一页——各站公示的都是「送你多少美元」，
 * 但按次计费的站一次请求就扣 $0.3~0.8，和按 token 的站根本不是一个量级。
 * 把两者折算到同一个单位（Claude Code 一问一答能跑多少次）才有可比性，
 * 折算假设写在页面上，不藏。
 */
import { creditPlan, usd, firstDayLabel, breakdown, usdTotals } from './credits.mjs';
import { signupRoute, acceptsNew } from './signup.mjs';
import { esc, fmt, pageShell, breadcrumb, faqLd } from './layout.mjs';
import { uptime, byDay, coverage } from './history.mjs';
import { icon } from './changelog.mjs';
import { activeSites, isArchived } from './archived.mjs';
import { subscriptionPlan } from './subscription.mjs';

/** 一次 Claude Code 往返的 token 量级：系统提示 + 工具结果吃掉大部分输入 */
export const TURN = { input: 15_000, output: 2_000 };

const pickClaude = (snap) => {
  const ms = snap?.models ?? [];
  const claude = ms.filter((m) => /^claude/i.test(m.name));
  const pool = claude.length ? claude : ms;
  // 按次计费的站挑最便宜的那档，按量计费的挑输出价最低的：都取「最省着用」的口径
  const fixed = pool.filter((m) => m.fixedPrice != null).sort((a, b) => a.fixedPrice - b.fixedPrice);
  if (fixed.length) return fixed[0];
  const tok = pool.filter((m) => m.outputPerMTok != null).sort((a, b) => a.outputPerMTok - b.outputPerMTok);
  return tok[0] ?? null;
};

/** 首日额度能跑多少次「一问一答」；返回 null 表示价格不公开，页面上如实写「需登录」 */
export function estimateTurns(site, snap) {
  if (isArchived(site)) return null;
  const p = creditPlan(site, snap);
  if (p.unit !== 'usd' || p.firstDay == null) return null;
  const m = pickClaude(snap);
  if (!m) return null;
  const per =
    m.fixedPrice != null
      ? m.fixedPrice
      : m.inputPerMTok != null && m.outputPerMTok != null
        ? (m.inputPerMTok * TURN.input + m.outputPerMTok * TURN.output) / 1_000_000
        : null;
  if (!per) return null;
  return { model: m.name, per, turns: Math.floor(p.firstDay / per), billing: m.fixedPrice != null ? '按次' : '按量' };
}

function compareRows(sites, byId) {
  return sites.map((s) => {
    const snap = byId.get(s.id);
    const p = creditPlan(s, snap);
    const sub = subscriptionPlan(s);
    const est = estimateTurns(s, snap);
    const billing = sub ? `${sub.name} 月订阅（付费）` : est?.billing ?? (p.note && p.firstDay == null ? '自带 Key / 订阅' : p.unit === 'point' ? '站内积分' : p.resets ? '每日额度池' : '需登录查看');
    const per = est ? `$${Math.round(est.per * 1000) / 1000} / 次` : '—';
    const turns = sub
      ? `${esc(sub.window)}：<br>${sub.estimates.map((e) => `${esc(e.model)} ${esc(e.amount)}`).join('<br>')}<br><small>${esc(sub.note)}</small>`
      : est
      ? `<b>${est.turns}</b> 次${p.resets ? ' / 天' : ''}`
      : p.unit === 'point'
        ? '积分无公开换算'
        : p.note && p.firstDay == null ? '不按赠送额度折算' : '需登录查看';
    // 停注的站点留在表里（老用户还用得上，也方便看它什么时候回来），但额度划掉、不参与「最耐用」排序
    const shut = !acceptsNew(snap);
    return `<tr${shut ? ' class="shut"' : ''}><td><a href="../sites/${esc(s.id)}/">${esc(s.name)}</a>${
      shut ? ' <span class="tag warn">停注</span>' : ''
    }</td><td>${esc(billing)}</td><td>${
      sub ? `<b>${esc(sub.label)}</b>${sub.listPrice ? `<br>官网标价 ${esc(sub.listPrice)}` : ''}<br><small>${esc(p.note ?? '')}</small>` : p.firstDay != null ? `${shut ? '<s>' : ''}${esc(firstDayLabel(p))}${shut ? '</s>' : ''}` : esc(p.note ?? '—')
    }</td><td>${per}</td><td>${turns}</td><td><code>${esc(est?.model ?? '—')}</code></td></tr>`;
  });
}

export function renderComparePage({ meta, sites: allSites, live, css }) {
  const sites = activeSites(allSites);
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  const url = `${meta.pagesUrl}compare/`;
  // 「最划算」得是新用户真能注册上的站，否则这页给出的答案是个死链
  const openSites = sites.filter((s) => acceptsNew(byId.get(s.id)));
  const closedSites = sites.filter((s) => !acceptsNew(byId.get(s.id)));
  const ranked = openSites
    .map((s) => ({ s, est: estimateTurns(s, byId.get(s.id)) }))
    .filter((x) => x.est)
    .sort((a, b) => b.est.turns - a.est.turns);
  const bestValue = ranked[0];
  const { total } = usdTotals(openSites.map((s) => creditPlan(s, byId.get(s.id))));

  const faq = [
    [
      '为什么送的美元一样多，能用的次数差这么远？',
      `按次计费的站一次请求固定扣钱（$0.2~0.8），和 tokens 用量无关；按量计费的站按 tokens 扣。同样 $100，按次站可能只够一两百次对话，按量站在轻负载下能跑更多次。`,
    ],
    [
      '一次「一问一答」按多少 token 算？',
      `本页统一按输入 ${TURN.input.toLocaleString('en-US')} tokens、输出 ${TURN.output.toLocaleString('en-US')} tokens 折算——Claude Code 的系统提示与工具结果占掉大部分输入。开了 prompt cache 或长上下文，实际值会明显偏离这个估算。`,
    ],
    ['哪个站最划算？', bestValue ? `按本页折算口径，还收新用户的站里 ${bestValue.s.name} 的首日额度能跑最多次（约 ${bestValue.est.turns} 次）。但公益站规则天天变，以站内实时公示为准。` : '价格数据不足，暂无法排序。'],
  ];

  const body = `  <header class="hero">
    <p class="crumb"><a href="../">${esc(meta.title)}</a> › 按次 vs 按量</p>
    <h1>按次计费 vs 按量计费</h1>
    <p class="sub">同样送 $100，能跑多少次 Claude Code 差十倍。把所有站折算到同一个单位再比。</p>
    <div class="pills">
      <span class="pill">收录 <b>${sites.length}</b> 站</span>
      ${total > 0 ? `<span class="pill">美元站全注册约 <b>$${total}</b></span>` : ''}
      ${bestValue ? `<span class="pill">最耐用 <b>${esc(bestValue.s.name)}</b></span>` : ''}
      <span class="pill">数据更新 <b>${esc(fmt(live?.generatedAt))}</b></span>
    </div>
  </header>

  <section>
    <h2>折算对比</h2>
    <p class="hint">「能跑多少次」= 首日额度 ÷ 单次成本。按次站直接用站内单价，按量站按输入 ${TURN.input.toLocaleString(
      'en-US',
    )} / 输出 ${TURN.output.toLocaleString('en-US')} tokens 估算，取各站最便宜的 Claude 型号。</p>
    <div class="table-wrap"><table>
      <thead><tr><th>站点</th><th>计费方式</th><th>首日额度 / 套餐</th><th>单次成本</th><th>约能跑 / 套餐用量</th><th>折算所用模型</th></tr></thead>
      <tbody>${compareRows(sites, byId).join('')}</tbody>
    </table></div>
    <p class="hint">每日重置额度池的站点，「约能跑」是每天的量，次日回满但不累积。积分站没有公开的积分—美元换算，不参与折算。${
      closedSites.length
        ? `${esc(closedSites.map((s) => s.name).join('、'))} 的接口自报已暂停新用户注册，额度已划掉、不参与「最耐用」排序。`
        : ''
    }</p>
  </section>

  <section>
    <h2>怎么挑</h2>
    <ul class="hl">
      <li>重度用 Claude Code（长上下文、大量工具调用）：优先按次计费的站，一次多贵都是固定价，不会被上下文撑爆。</li>
      <li>轻量问答、写小段代码：按量计费更划算，同样的钱能跑更多次。</li>
      <li>想长期不断供：看有没有每日签到或每日重置额度池——一次性注册额度总会用完。</li>
      <li>都注册一遍最稳：额度互不影响，一个站限速就换下一个。</li>
    </ul>
  </section>

  <section><h2>常见问题</h2>
    ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n    ')}
  </section>`;

  return pageShell({
    meta,
    css,
    live,
    base: '../',
    current: 'compare/',
    title: `按次计费 vs 按量计费：${sites.length} 个 AI Coding 福利站折算横评 — ${meta.title}`,
    desc: `把 ${sites.length} 个免费 AI Coding 中转站 / 公益站的首日额度折算成「能跑多少次 Claude Code 一问一答」，按次计费与按量计费同尺度对比，数据快照 ${fmt(
      live?.generatedAt,
    )}。`,
    canonical: url,
    jsonLd: [
      breadcrumb(meta, [
        { name: meta.title, url: meta.pagesUrl },
        { name: '按次 vs 按量', url },
      ]),
      faqLd(faq),
    ],
    body,
  });
}

/** 一天一格：满格在线、半格有掉线、空档表示那天没有样本（而不是掉线） */
function dayBars(history, siteId, days) {
  return `<div class="bars" role="img" aria-label="最近 ${days} 天可用性">${byDay(history, siteId, days)
    .map((d) => {
      const cls = d.total === 0 ? 'nodata' : d.ratio === 1 ? 'ok' : d.ratio > 0 ? 'part' : 'bad';
      const label = d.total === 0 ? `${d.date} 无样本` : `${d.date} ${d.up}/${d.total} 次在线`;
      return `<i class="bar ${cls}" title="${esc(label)}"></i>`;
    })
    .join('')}</div>`;
}

const pct = (u) => (u.enough ? `${u.percent}%` : `样本不足（${u.total} 次）`);

export function renderStatusPage({ meta, sites: allSites, live, css, history }) {
  const sites = activeSites(allSites);
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  const cov = coverage(history);
  const url = `${meta.pagesUrl}status/`;
  const rows = sites.map((s) => {
    const snap = byId.get(s.id);
    const u7 = uptime(history, s.id, 7);
    const u30 = uptime(history, s.id, 30);
    return `<tr>
      <td><a href="../sites/${esc(s.id)}/">${esc(s.name)}</a></td>
      <td><span class="dot ${snap?.online ? 'up' : 'down'}"></span> ${snap?.online ? '在线' : '异常'}${
        // 在线 ≠ 收新用户，两件事分开显示，否则这页会被当成「能不能注册」的依据
        acceptsNew(snap) ? '' : ' <span class="tag warn">停注</span>'
      }</td>
      <td>${dayBars(history, s.id, 7)}</td>
      <td>${esc(pct(u7))}</td>
      <td>${esc(pct(u30))}</td>
      <td>${u7.blocked || 0}</td>
      <td>${snap?.latencyMs != null ? `${snap.latencyMs} ms` : '—'}</td>
    </tr>`;
  });

  const faq = [
    ['可用性是怎么测的？', `CI 每 6 小时探一次各站的注册页与公开接口，结果压进仓库里的 data/history.json。目前已记录 ${cov.samples} 个样本，覆盖约 ${cov.days} 天。`],
    ['为什么有的站显示「探测被拦下」？', '公益站前面普遍挂 Cloudflare，GitHub Actions 的机房 IP 容易吃到挑战页。这种情况不算掉线，状态沿用上一次成功探测的结果，并单独计入「被拦次数」——家宽访问通常不受影响。'],
    ['显示异常的站还能用吗？', '可能能。本页只代表自动探测视角：注册页与公开接口都没响应就标异常。真要用请自己开一下站点，或看该站详情页里的备用域名。'],
    ['标了「停注」是什么意思？', '站点自己的接口报 register_enabled=false，也就是不收新用户了；站点本身还在跑，老用户不受影响。重新开放会自动记进变动日志。'],
  ];

  const body = `  <header class="hero">
    <p class="crumb"><a href="../">${esc(meta.title)}</a> › 可用性</p>
    <h1>福利站可用性</h1>
    <p class="sub">每 6 小时自动探一次，历史存在仓库里。哪个站还活着，看这页。</p>
    <div class="pills">
      <span class="pill">样本 <b>${cov.samples}</b> 个</span>
      <span class="pill">覆盖 <b>${cov.days}</b> 天</span>
      <span class="pill">最后探测 <b>${esc(fmt(live?.generatedAt))}</b></span>
    </div>
  </header>

  <section>
    <h2>最近 7 天</h2>
    <p class="hint">每格一天：满格全在线，半格当天有掉线，空档表示那天没有样本。</p>
    <div class="table-wrap"><table>
      <thead><tr><th>站点</th><th>现在</th><th>最近 7 天</th><th>7 天可用</th><th>30 天可用</th><th>被 WAF 拦</th><th>延迟</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
    ${cov.days < 7 ? `<p class="hint">⚠ 历史只攒了约 ${cov.days} 天，30 天口径要等样本够了才有意义。</p>` : ''}
  </section>

  <section><h2>常见问题</h2>
    ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n    ')}
  </section>`;

  return pageShell({
    meta,
    css,
    live,
    base: '../',
    current: 'status/',
    title: `福利站可用性监控：哪个 AI Coding 中转站还活着 — ${meta.title}`,
    desc: `${sites.length} 个免费 AI Coding 中转站 / 公益站的可用性历史，每 6 小时自动探测一次，含 7 天与 30 天在线率、WAF 拦截次数与接口延迟。最后探测 ${fmt(
      live?.generatedAt,
    )}。`,
    canonical: url,
    jsonLd: [
      breadcrumb(meta, [
        { name: meta.title, url: meta.pagesUrl },
        { name: '可用性', url },
      ]),
      faqLd(faq),
    ],
    body,
  });
}

export function renderChangelogPage({ meta, groups, live, css, limitDays = 60, siteIds = [] }) {
  const url = `${meta.pagesUrl}changelog/`;
  const shown = groups.slice(0, limitDays);
  const count = shown.reduce((n, g) => n + g.events.length, 0);
  // 事件里的推荐详情入口只留给未归档站；历史事件本身照常保留。
  const hasPage = new Set(siteIds);

  const days = shown
    .map(
      (g) => `    <section class="day" id="${esc(g.date)}">
      <h2><a href="#${esc(g.date)}">${esc(g.date)}</a> <span class="muted">${g.events.length} 项</span></h2>
      <ul class="events">${g.events
        .map(
          (e) =>
            `<li><span class="ev-ico">${icon(e.type)}</span><span>${esc(e.text)}</span>${
              e.siteId && hasPage.has(e.siteId) ? ` <a class="ev-site" href="../sites/${esc(e.siteId)}/">详情</a>` : ''
            }</li>`,
        )
        .join('')}</ul>
    </section>`,
    )
    .join('\n');

  const body = `  <header class="hero">
    <p class="crumb"><a href="../">${esc(meta.title)}</a> › 变动日志</p>
    <h1>变动日志</h1>
    <p class="sub">站点上下线、额度调整、模型与价格变化。CI 每 6 小时比对一次快照，自动记录。</p>
    <div class="pills">
      <span class="pill">已记录 <b>${count}</b> 项变动</span>
      <span class="pill">覆盖 <b>${shown.length}</b> 天</span>
      <span class="pill">最后比对 <b>${esc(fmt(live?.generatedAt))}</b></span>
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="${esc(`${meta.pagesUrl}feed.xml`)}">Atom 订阅</a>
      <a class="btn btn-ghost" href="${esc(`${meta.repoUrl}/releases`)}" target="_blank" rel="noopener">GitHub Releases 邮件通知</a>
    </div>
    <p class="hint">想要额度变动第一时间知道：订阅 Atom，或在仓库点 Watch → Custom → Releases。</p>
  </header>

${days || '    <section><p class="hint">还没有记录到变动，CI 跑够两次就会有了。</p></section>'}`;

  return pageShell({
    meta,
    css,
    live,
    base: '../',
    current: 'changelog/',
    title: `变动日志：福利站额度 / 模型 / 上下线记录 — ${meta.title}`,
    desc: `免费 AI Coding 中转站与公益站的变动记录：新站收录、掉线恢复、邀请额度调整、模型上下线与价格变化，每 6 小时自动比对。最后更新 ${fmt(
      live?.generatedAt,
    )}。`,
    canonical: url,
    jsonLd: [
      breadcrumb(meta, [
        { name: meta.title, url: meta.pagesUrl },
        { name: '变动日志', url },
      ]),
    ],
    body,
  });
}
