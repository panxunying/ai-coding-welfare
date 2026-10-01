/**
 * 站点详情页 docs/sites/<id>/index.html。
 *
 * 为什么值得单独一页：搜索里高意图的词是「站名 + 邀请码 / 怎么配 / 额度 / 401」，
 * 这些词落在一个大杂烩首页上排不动，一站一页才吃得到长尾；
 * 内容全部来自 sites.json + live.json + history.json，不新增维护成本。
 */
import { creditPlan, usd, breakdown } from './credits.mjs';
import { signupRoute } from './signup.mjs';
import { staleHours } from './newapi.mjs';
import { esc, fmt, pageShell, breadcrumb, faqLd, COPY_SCRIPT } from './layout.mjs';
import { uptime } from './history.mjs';
import { isArchived, archivedAt, archivedReason } from './archived.mjs';
import { subscriptionPlan, renderSubscription } from './subscription.mjs';

const yes = (v) => (v === true ? '✅' : v === false ? '❌' : '—');

function factRows(site, snap) {
  const p = creditPlan(site, snap);
  const route = signupRoute(snap);
  const shut = route.state === 'closed';
  return [
    p.firstDay != null
      ? ['首日可得', `<b${shut ? ' class="struck"' : ''}>${usd(p.firstDay, p.approx, p.unit)}</b>${shut ? '<small> 站点停注中，新号拿不到</small>' : ''}`]
      : p.note ? ['免费范围', esc(p.note)] : null,
    p.sources > 1 && breakdown(p) ? ['额度构成', esc(breakdown(p))] : null,
    p.daily != null
      ? ['之后每天', p.resets ? `重置额度池 ${usd(p.daily, p.approx, p.unit)}（不累积）` : `签到 ${usd(p.daily, p.approx, p.unit)}`]
      : null,
    p.inviter ? ['邀请他人可得', `$${p.inviter}`] : null,
    snap?.systemName ? ['站点名称', esc(snap.systemName)] : null,
    snap?.version ? ['面板版本', `<code>${esc(snap.version)}</code>`] : null,
    snap?.services?.length ? ['已开放服务', esc(snap.services.join(' / '))] : null,
    snap?.checkinEnabled != null ? ['每日签到', yes(snap.checkinEnabled)] : null,
    snap?.registerOpen != null ? ['开放注册', `${yes(snap.registerOpen)}${route.short ? `（${esc(route.short)}）` : ''}`] : null,
    snap?.loginMethods?.length ? ['登录方式', esc(snap.loginMethods.join(' / '))] : null,
    snap?.githubMinAccountAgeDays ? ['账号门槛', `GitHub 满 ${snap.githubMinAccountAgeDays} 天`] : null,
    snap?.latencyMs != null ? ['接口延迟', `${snap.latencyMs} ms`] : null,
    ['数据快照', esc(fmt(snap?.staleFrom ?? snap?.checkedAt))],
  ].filter(Boolean);
}

function modelsTable(snap) {
  if (!snap?.models?.length) return '';
  const fixedAny = snap.models.some((m) => m.fixedPrice != null);
  const rows = snap.models.map((m) => {
    const fixed = m.fixedPrice != null;
    return `<tr><td><code>${esc(m.name)}</code></td><td>${fixed ? '按次' : (m.ratio ?? '—')}</td><td>${
      fixed ? `<b>$${m.fixedPrice} / 次</b>` : m.inputPerMTok != null ? `$${m.inputPerMTok}` : '—'
    }</td><td>${fixed ? '—' : m.outputPerMTok != null ? `$${m.outputPerMTok}` : '—'}</td><td>${esc(
      (m.protocols ?? []).join(' / '),
    )}</td></tr>`;
  });
  return `<section><h2>当前可用模型与价格</h2><p class="hint">${
    fixedAny
      ? '标「按次」的模型按请求次数计费，与 tokens 无关；其余倍率 1 ≈ $2 / 1M tokens。'
      : '倍率 1 ≈ $2 / 1M tokens。'
  }抓取自站点公开定价接口，一切以站内实时公示为准。</p>
    <div class="table-wrap"><table><thead><tr><th>模型</th><th>倍率</th><th>输入 /1M</th><th>输出 /1M</th><th>协议</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div></section>`;
}

function configBlocks(site, snap) {
  const anth = site.endpoints?.anthropic;
  const oai = site.endpoints?.openai;
  const cm = snap?.defaults?.claude ?? '<登录后台查看可用模型名>';
  const om = snap?.defaults?.openai ?? '<登录后台查看可用模型名>';
  const out = [];

  if (anth) {
    out.push(`<h3>Claude Code（Anthropic 兼容，Base URL 不带 <code>/v1</code>）</h3>
      <pre><code>${esc(
        [
          `export ANTHROPIC_BASE_URL=${anth}`,
          'export ANTHROPIC_AUTH_TOKEN=你在站点后台创建的 Key',
          `export ANTHROPIC_MODEL=${cm}`,
          'npm install -g @anthropic-ai/claude-code@latest && claude',
        ].join('\n'),
      )}</code></pre><button class="copy" type="button">复制配置</button>`);
  }
  if (oai) {
    out.push(`<h3>Codex CLI（写入 <code>~/.codex/config.toml</code>）</h3>
      <pre><code>${esc(
        [
          `model = "${om}"`,
          `model_provider = "${site.id}"`,
          '',
          `[model_providers.${site.id}]`,
          `name = "${site.name}"`,
          `base_url = "${oai}"`,
          `env_key = "${site.id.toUpperCase()}_API_KEY"`,
          'wire_api = "chat"',
        ].join('\n'),
      )}</code></pre><button class="copy" type="button">复制配置</button>
      <h3>通用客户端（Cherry Studio / Cursor / OpenAI SDK）</h3>
      <p class="hint">只需两项：Base URL = <code>${esc(oai)}</code>，API Key = 站点后台创建的 Key。</p>`);
  }
  if (!anth && !oai) {
    const s = site.setup ?? {};
    out.push(
      `<p class="hint">${esc(s.note ?? '注册登录后在站内后台查看接入方式。')}</p>`,
      s.steps?.length ? `<ol class="hl">${s.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : '',
      s.dashboardUrl ? `<p><a class="btn btn-ghost" href="${esc(s.dashboardUrl)}" target="_blank" rel="noopener">打开控制台</a></p>` : '',
    );
  }
  return `<section id="config"><h2>接入配置</h2>${out.join('\n')}</section>`;
}

function uptimeBlock(site, history) {
  const u = uptime(history, site.id, 7);
  if (!u.total) return '';
  const body = u.enough
    ? `最近 7 天自动探测 ${u.total} 次，在线 ${u.up} 次（<b>${u.percent}%</b>）${
        u.blocked ? `，其中 ${u.blocked} 次探测被站点 WAF 拦下，按上一次成功状态计` : ''
      }。`
    : `样本还不够（仅 ${u.total} 次探测），可用性百分比先不给，等历史攒够再说。`;
  return `<section><h2>最近 7 天可用性</h2><p class="hint">${body}</p>
    <p><a class="navlink" href="../../status/">看全部站点的可用性 →</a></p></section>`;
}

function list(title, items, cls = 'hl') {
  if (!items?.length) return '';
  return `<section><h2>${esc(title)}</h2><ul class="${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
}

export function renderSitePage({ meta, site, snap, live, css, history, siblings = [] }) {
  // 旧地址仍可访问，但不能继续展示过期的额度、注册链接和接入配置。
  if (isArchived(site)) {
    const when = archivedAt(site);
    return pageShell({
      meta, css, live, base: '../../', noindex: true,
      title: `${site.name} 已归档 — ${meta.title}`,
      desc: `${site.name} 已移入历史区，不再推荐注册。${archivedReason(site)}`,
      canonical: `${meta.pagesUrl}sites/${site.id}/`,
      body: `<header class="hero"><h1>${esc(site.name)} · 已归档</h1>
        <p class="sub">${esc(archivedReason(site))}</p>
        ${when ? `<p class="hint">归档日期：${esc(when)}</p>` : ''}
        <p>不再展示旧额度、注册链接或接入配置；历史记录保留。</p>
        <a class="btn btn-ghost" href="../../#graveyard">返回历史区</a></header>`,
    });
  }
  const p = creditPlan(site, snap);
  const up = Boolean(snap?.online);
  const sub = subscriptionPlan(site);
  const route = signupRoute(snap);
  const shut = route.state === 'closed';
  const url = `${meta.pagesUrl}sites/${site.id}/`;
  const title = sub ? `${site.name} ${sub.label} / 套餐用量 / 邀请链接 — ${meta.title}` : `${site.name} 免费额度 / 邀请链接 / Claude Code 配置 — ${meta.title}`;
  const desc = `${site.name}：${site.subtitle}${
    shut ? '。⚠ 站点接口自报已暂停新用户注册' : p.firstDay != null ? `。首日可得 ${usd(p.firstDay, p.approx, p.unit)}${breakdown(p) ? `（${breakdown(p)}）` : ''}` : ''
  }。含实时在线状态、模型价格、Claude Code / Codex 接入配置与踩坑清单，数据快照 ${fmt(snap?.checkedAt)}。`;

  const faq = site.faq ?? [
    [`${site.name} 注册完为什么看不到额度？`, '公益站额度多在登录时结算，退出登录再重新登录一次通常就到账；余额短暂显示 $0 属于前端展示问题，稍后刷新即可。'],
    [`${site.name} 的 Claude Code 报 401 怎么办？`, 'Anthropic 协议的 Base URL 不要带 /v1；再确认 Key 复制完整、模型名在站内可用清单里、客户端属于该站支持的类型。'],
    [`从别的链接注册 ${site.name} 有区别吗？`, `有。${
      p.invite != null ? `邀请额度 ${usd(p.invite, false, p.unit)} 是在注册那一刻结算的，走裸链拿不到，事后也补不上。` : '邀请额度在注册那一刻结算，走裸链拿不到，事后补不上。'
    }`],
  ];

  const body = `  <header class="hero">
    <p class="crumb"><a href="../../">${esc(meta.title)}</a> › ${esc(site.name)}</p>
    <h1>${esc(site.name)}</h1>
    <p class="sub">${esc(site.subtitle)}</p>
    <div class="pills">
      <span class="pill"><span class="dot ${up ? 'up' : 'down'}"></span> ${up ? '在线' : '探测异常'}</span>
      ${shut ? '<span class="pill warn">暂停注册</span>' : ''}
      ${sub ? `<span class="pill"><b>${esc(sub.label)}</b></span>` : ''}
      ${p.firstDay != null ? `<span class="pill">首日可得 <b>${usd(p.firstDay, p.approx, p.unit)}</b></span>` : ''}
      ${snap?.models?.length ? `<span class="pill">可查模型 <b>${snap.models.length}</b> 个</span>` : ''}
      <span class="pill">数据更新 <b>${esc(fmt(snap?.checkedAt))}</b></span>
    </div>
    <div class="cta-row">
      <a class="btn ${shut ? 'btn-ghost' : 'btn-primary'}" href="${esc(site.signupUrl)}" target="_blank" rel="noopener">${
        shut ? `打开 ${esc(site.name)}（已停注）→` : sub ? `查看 ${esc(site.name)} ${esc(sub.label)} →` : `免费注册 ${esc(site.name)} →`
      }</a>
      <a class="btn btn-ghost" href="#config">直接看接入配置</a>
    </div>
    ${route.note ? `<p class="notice">${esc(route.note)}${shut ? '　可以先看下面「同类站点」里还在收人的。' : ''}</p>` : ''}
    ${
      staleHours(snap)
        ? `<p class="hint">⚠ 接口已连续 ${staleHours(snap)} 小时没抓到新数据，本页明细为 ${esc(fmt(snap.staleFrom))} 的快照。</p>`
        : ''
    }
  </header>

  <section><h2>${sub ? '套餐价格与用量' : '能拿多少额度'}</h2>
    ${renderSubscription(site)}
    <dl class="kv">${factRows(site, snap).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
  </section>

  ${list('为什么值得注册', site.highlights)}
  ${modelsTable(snap)}
  ${!snap?.models?.length && site.modelsNote ? `<section><h2>模型与套餐说明</h2><p class="hint">${esc(site.modelsNote)}</p></section>` : ''}
  ${list('注册要求', site.register?.requirements)}
  ${configBlocks(site, snap)}
  ${list('如何继续拿额度', site.earnMore)}
  ${list('⚠️ 使用前必读', site.caveats)}
  ${uptimeBlock(site, history)}
  ${
    (site.mirrors ?? []).length
      ? `<section><h2>镜像 / 备用入口</h2><ul class="hl">${site.mirrors
          .map((m) => `<li>${esc(m.label ?? '备用域名')}：<a href="${esc(m.signupUrl)}" target="_blank" rel="noopener">${esc(m.homeUrl)}</a></li>`)
          .join('')}</ul></section>`
      : ''
  }
  ${list('官方渠道', site.community)}

  <section><h2>常见问题</h2>
    ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n    ')}
  </section>

  <section><h2>其它福利站</h2>
    <p class="hint">额度用完了就换一家，各站额度互不影响。</p>
    <ul class="hl">${siblings
      .map((s) => `<li><a href="../${esc(s.id)}/">${esc(s.name)}</a> — ${esc(s.subtitle)}</li>`)
      .join('')}</ul>
  </section>
${COPY_SCRIPT}`;

  return pageShell({
    meta,
    css,
    live,
    base: '../../',
    title,
    desc,
    canonical: url,
    languagePath: `sites/${site.id}/`,
    jsonLd: [
      breadcrumb(meta, [
        { name: meta.title, url: meta.pagesUrl },
        { name: site.name, url },
      ]),
      faqLd(faq),
    ],
    body,
  });
}
