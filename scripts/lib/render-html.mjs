/**
 * 生成 docs/index.html（GitHub Pages 落地页）。
 *
 * 这一页只负责「一眼看完所有站」，深度内容分流到 docs/sites/<id>/、/compare/、/status/、/changelog/，
 * 外壳（head / 导航 / 页脚 / JSON-LD）统一走 lib/layout.mjs，别在这儿再写一套。
 */
import { staleHours } from './newapi.mjs';
import { creditPlan, usd, breakdown, usdTotals, othersNote } from './credits.mjs';
import { signupRoute, acceptsNew } from './signup.mjs';
import { esc, fmt, pageShell, faqLd, COPY_SCRIPT } from './layout.mjs';
import { icon } from './changelog.mjs';
import { coverage } from './history.mjs';
import { activeSites, archivedSites, archivedAt, archivedReason } from './archived.mjs';
import { subscriptionPlan, renderSubscription } from './subscription.mjs';

function claudeSnippet(site, snap) {
  const model = snap?.defaults?.claude ?? '在站内模型列表中选择';
  return [
    `export ANTHROPIC_BASE_URL=${site.endpoints.anthropic}`,
    `export ANTHROPIC_AUTH_TOKEN=你的 API Key`,
    `export ANTHROPIC_MODEL=${model}`,
    `claude`,
  ].join('\n');
}

/** 有公开 Base URL 才给可复制的配置；Codex 号池那类站点只能写清楚去后台哪儿领 */
function accessBlock(site, snap) {
  if (site.endpoints?.anthropic) {
    return `<pre><code>${esc(claudeSnippet(site, snap))}</code></pre>
        <button class="copy" type="button">复制配置</button>`;
  }
  const steps = site.setup?.steps ?? [];
  const note = site.setup?.note ?? '注册登录后在站内后台查看接入方式。';
  return `<p class="desc">${esc(note)}</p>${
    steps.length ? `<ol class="hl">${steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''
  }`;
}

function siteCard(site, snap) {
  const sub = subscriptionPlan(site);
  const up = Boolean(snap?.online);
  const p = creditPlan(site, snap);
  const route = signupRoute(snap);
  const shut = route.state === 'closed';
  const facts = [
    p.firstDay != null
      ? [
          '首日可得',
          `<b${shut ? ' class="struck"' : ''}>${usd(p.firstDay, p.approx, p.unit)}</b>${
            shut ? '<small> 站点停注中，新号拿不到</small>' : p.sources > 1 && breakdown(p) ? `<small> ${esc(breakdown(p))}</small>` : ''
          }`,
        ]
      : p.note ? ['免费范围', esc(p.note)] : null,
    p.daily != null
      ? ['之后每天', p.resets ? `重置额度池 ${usd(p.daily, p.approx, p.unit)}（不累积）` : `签到 ${usd(p.daily, p.approx, p.unit)}`]
      : snap?.checkinEnabled
        ? ['每日签到', '支持']
        : snap?.checkinEnabled === false
          ? ['每日签到', '不支持']
          : null,
    p.inviter ? ['邀请他人', `$${p.inviter}`] : null,
    snap?.services?.length ? ['已开放服务', esc(snap.services.join(' / '))] : null,
    route.short ? ['注册通道', esc(route.short)] : null,
    snap?.loginMethods?.length ? ['登录方式', esc(snap.loginMethods.join(' / '))] : null,
    snap?.githubMinAccountAgeDays ? ['账号门槛', `GitHub 满 ${snap.githubMinAccountAgeDays} 天`] : null,
    sub ? null : snap?.models?.length ? ['可用模型', snap.models.map((m) => esc(m.name)).join('、')]
      : site.modelsSummary ? ['可用模型', `<b>${esc(site.modelsSummary)}</b>`]
      : ['可用模型', '登录后台查看'],
    ['接口延迟', snap?.latencyMs != null ? `${snap.latencyMs} ms` : '—'],
    staleHours(snap) ? ['数据快照', `${fmt(snap.staleFrom)}（接口暂未响应，沿用上次结果）`] : null,
    snap?.probeBlocked && !staleHours(snap)
      ? ['数据快照', `${fmt(snap.staleFrom ?? snap.checkedAt)}（本次探测被站点 WAF 拦下，机房 IP 常见，不影响家宽访问）`]
      : null,
  ].filter(Boolean);

  return `
      <article class="card${site.recommended ? ' featured' : ''}${shut ? ' shut' : ''}">
        <h3><span class="dot ${up ? 'up' : 'down'}" title="${up ? '在线' : '异常'}"></span>${esc(site.name)}${
          site.recommended ? '<span class="tag">首推</span>' : ''
        }${shut ? '<span class="tag warn">暂停注册</span>' : ''}</h3>
        <p class="desc">${esc(site.subtitle)}</p>
        ${route.note ? `<p class="notice">${esc(route.note)}</p>` : ''}
        <div class="tags">${(site.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        ${renderSubscription(site)}
        <dl class="kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        <ul class="hl">${(site.highlights ?? []).slice(0, 3).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        ${accessBlock(site, snap)}
        <div class="mt-auto"></div>
        <a class="btn ${shut ? 'btn-ghost' : 'btn-primary'}" href="${esc(site.signupUrl)}" target="_blank" rel="noopener">${
          shut ? `打开 ${esc(site.name)}（已停注）→` : sub ? `查看 ${esc(site.name)} ${esc(sub.label)} →` : `免费注册 ${esc(site.name)} →`
        }</a>
        <a class="btn btn-ghost" href="sites/${esc(site.id)}/">额度明细 / 接入配置 / 可用性 →</a>
        ${(site.mirrors ?? [])
          .map((m) => `<a class="btn btn-ghost" href="${esc(m.signupUrl)}" target="_blank" rel="noopener">${esc(m.label ?? '备用入口')}</a>`)
          .join('')}
      </article>`;
}

function modelsTable(sites, byId) {
  const rows = [];
  let fixedAny = false;
  for (const s of sites) {
    for (const m of byId.get(s.id)?.models ?? []) {
      // 按次计费的模型没有倍率，接口里的 0 不能照抄（会被读成免费），价格挪到输入列
      const fixed = m.fixedPrice != null;
      if (fixed) fixedAny = true;
      rows.push(
        `<tr><td>${esc(s.name)}</td><td><code>${esc(m.name)}</code></td><td>${fixed ? '按次' : (m.ratio ?? '—')}</td>` +
          `<td>${fixed ? `<b>$${m.fixedPrice} / 次</b>` : m.inputPerMTok != null ? `$${m.inputPerMTok}` : '—'}</td>` +
          `<td>${fixed ? '—' : m.outputPerMTok != null ? `$${m.outputPerMTok}` : '—'}</td>` +
          `<td>${esc((m.protocols ?? []).join(' / '))}</td></tr>`,
      );
    }
  }
  if (!rows.length) return '';
  const hint = fixedAny
    ? '抓取自各站点公开的定价接口；标「按次」的模型按请求次数计费，与 tokens 无关，其余倍率 1 ≈ $2 / 1M tokens，一切以站内实时公示为准。'
    : '抓取自各站点公开的定价接口；倍率 1 ≈ $2 / 1M tokens，一切以站内实时公示为准。';
  return `
    <section id="models">
      <h2>可用模型与价格</h2>
      <p class="hint">${hint}</p>
      <div class="table-wrap">
      <table>
        <thead><tr><th>站点</th><th>模型</th><th>倍率</th><th>输入 /1M</th><th>输出 /1M</th><th>协议</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      </div>
    </section>`;
}

/** 首页只放最近几条变动做「这站还活着」的信号，完整列表在 /changelog/ */
function recentSection(groups, history, activeIds) {
  const activeById = new Set(activeIds ?? []);
  const events = groups.flatMap((g) => g.events).slice(0, 8);
  const cov = coverage(history);
  if (!events.length) return '';
  return `
    <section id="changes">
      <h2>最近变动</h2>
      <p class="hint">CI 每 6 小时比对一次各站快照${
        cov.samples ? `，已攒下 ${cov.samples} 个样本、覆盖约 ${cov.days} 天` : ''
      }。额度调整、掉线恢复、模型上下线都会自动记一条。</p>
      <ul class="events">${events
        .map(
          (e) =>
            `<li><span class="ev-ico">${icon(e.type)}</span><span>${esc(e.text)}</span>${
              // 归档站只剩归档说明，不再作为推荐详情入口。
              e.siteId && activeById.has(e.siteId) ? ` <a class="ev-site" href="sites/${esc(e.siteId)}/">详情</a>` : ''
            } <span class="muted">${esc(String(e.at ?? '').slice(0, 10))}</span></li>`,
        )
        .join('')}</ul>
      <div class="cta-row">
        <a class="btn btn-ghost" href="changelog/">完整变动日志 →</a>
        <a class="btn btn-ghost" href="feed.xml">Atom 订阅</a>
        <a class="btn btn-ghost" href="status/">可用性历史 →</a>
      </div>
    </section>`;
}

const FAQ = [
  ['注册完看不到额度？', '公益站额度多在登录时结算，退出后重新登录一次通常就到账；余额短暂显示 $0 属于展示问题，稍后刷新即可。'],
  ['Claude Code 报 401？', 'Anthropic 协议的 Base URL 不要带 /v1；再确认 Key 完整、模型名在站内可用清单里、客户端属于该站支持的类型。'],
  ['返回 400 content blocked？', '部分站点只放行中 / 英 / 法 / 德 / 俄，提示词混入其它语言会被上游拦截。'],
  ['会不会顶掉我的 Claude 订阅登录？', '会。环境变量优先级更高，想切回订阅登录就 unset ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL 后重开终端。'],
];

/** 坟场：曾经收录、后来挂掉的站点。留在页面最底下，只记名不吆喝，链接也不再给 */
function graveyardSection(sites) {
  const dead = archivedSites(sites);
  if (!dead.length) return '';
  const items = dead
    .map((s) => {
      const when = archivedAt(s);
      return `<li><span class="dot down" aria-hidden="true"></span><b>${esc(s.name)}</b>${
        when ? ` <span class="muted">（${esc(when)} 归档）</span>` : ''
      }<span class="muted">${esc(archivedReason(s))}</span></li>`;
    })
    .join('');
  return `
    <section id="graveyard">
      <h2>📦 历史区 · 已停用站点</h2>
      <p class="hint">这些站已反馈不可用，不再推荐注册、展示额度或进行定时探测。保留历史记录，确认恢复可用后可人工重新收录。</p>
      <ul class="events">${items}</ul>
    </section>`;
}

export function renderHtml({ meta, sites: allSites, live, css, groups = [], history }) {
  // 挂掉的站点不进主列表、不计入任何合计与 ItemList，只进底部坟场区块
  const sites = activeSites(allSites);
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  const online = sites.filter((s) => byId.get(s.id)?.online).length;
  // 停注的站点不进「新用户能拿多少」的口径，也不当首屏主按钮（详见 lib/signup.mjs）
  const openSites = sites.filter((s) => acceptsNew(byId.get(s.id)));
  const closedSites = sites.filter((s) => !acceptsNew(byId.get(s.id)));
  const plans = openSites.map((s) => creditPlan(s, byId.get(s.id)));
  // 合计只算美元站：积分与美元没有公开换算，混着加就是编数字（详见 lib/credits.mjs）
  const { best, total, others } = usdTotals(plans);
  const extra = othersNote(others);
  const first = openSites.find((s) => s.recommended) ?? openSites[0] ?? null;
  const firstSub = subscriptionPlan(first);
  const deadCount = archivedSites(allSites).length;
  const desc = `${meta.tagline}。当前收录 ${sites.length} 个站点，${online} 个在线${
    closedSites.length ? `、${openSites.length} 个还收新用户` : ''
  }${best ? `，单站首日最高可得 $${best} 免费额度，还收新用户的美元站全注册约 $${total}` : ''}${extra ? `；${extra}` : ''}${
    deadCount ? `；另有 ${deadCount} 个站已停用归档` : ''
  }。`;

  // 投稿公告放在大标题上方：首屏第一眼就能看到，和 README 顶部的 [!TIP] 提示块同一个口径
  const body = `  <header class="hero">
    <p class="announce">
      <span>📣 <b>欢迎投稿</b>：Issue 区就是你的免费推广位，邀请链接可以直接贴，特别优质的会收录进本站</span>
      <a href="${esc(`${meta.repoUrl}/issues/new/choose`)}" target="_blank" rel="noopener">提交 Issue →</a>
      <a href="${esc(`${meta.repoUrl}/issues`)}" target="_blank" rel="noopener">逛逛 Issue 区</a>
    </p>
    <h1>${esc(meta.title)}</h1>
    <p class="sub">${esc(meta.tagline)}</p>
    <div class="pills">
      <span class="pill">收录 <b>${sites.length}</b> 站</span>
      <span class="pill">在线 <b>${online}/${sites.length}</b></span>
      ${closedSites.length ? `<span class="pill">可注册 <b>${openSites.length}/${sites.length}</b></span>` : ''}
      ${best ? `<span class="pill">首日最高 <b>$${best}</b></span>` : ''}
      ${total > best ? `<span class="pill">美元站全注册约 <b>$${total}</b></span>` : ''}
      <span class="pill">数据更新 <b>${esc(fmt(live?.generatedAt))}</b></span>
    </div>
    <div class="cta-row">
      ${
        // 一个还收人的站都没有时，首屏主按钮不能继续喊「立即免费注册」——点进去也注册不了
        first
          ? `<a class="btn btn-primary" href="${esc(first.signupUrl)}" target="_blank" rel="noopener">${firstSub ? `查看 ${esc(first.name)} ${esc(firstSub.label)}` : `立即免费注册 ${esc(first.name)}`} →</a>`
          : `<a class="btn btn-primary" href="#sites">收录的站现在都停注了，看看各站状态 →</a>`
      }
      <a class="btn btn-ghost" href="compare/">哪个站最耐用？按次 vs 按量 →</a>
      <a class="btn btn-ghost" href="${esc(meta.repoUrl)}" target="_blank" rel="noopener">GitHub 仓库 ⭐</a>
    </div>
  </header>

  <section id="sites">
    <h2>站点一览</h2>
    <p class="hint">额度、模型、在线状态由脚本定时抓取站点公开接口自动更新。</p>
    ${
      closedSites.length
        ? `<p class="hint">🟡 ${esc(
            closedSites.map((s) => s.name).join('、'),
          )} 的接口自报已关闭新用户注册，卡片上的额度已划掉、也没算进上面的合计——站点本身还在跑，老用户不受影响，重新开放会记进变动日志。</p>`
        : ''
    }
    ${extra ? `<p class="hint">${esc(extra)}——站内积分与美元没有公开换算关系，未计入上面的美元合计。</p>` : ''}
    <div class="grid">${sites.map((s) => siteCard(s, byId.get(s.id))).join('')}
    </div>
  </section>
${modelsTable(sites, byId)}
${recentSection(groups, history, sites.map((s) => s.id))}
${graveyardSection(allSites)}
  <section id="faq">
    <h2>常见问题</h2>
    <p class="hint">踩坑集中在这四个。</p>
    ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n    ')}
  </section>
${COPY_SCRIPT}`;

  // ItemList 让搜索引擎和 AI 抓取时知道这页是「N 个站点的清单」，每项指向各自的详情页
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: meta.title,
    numberOfItems: sites.length,
    itemListElement: sites.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.name,
      description: s.subtitle,
      url: `${meta.pagesUrl}sites/${s.id}/`,
    })),
  };

  return pageShell({
    meta,
    css,
    live,
    base: '',
    current: '',
    title: `${meta.title} — ${meta.tagline}`,
    desc,
    canonical: meta.pagesUrl,
    languagePath: '',
    jsonLd: [itemList, faqLd(FAQ)],
    body,
  });
}
