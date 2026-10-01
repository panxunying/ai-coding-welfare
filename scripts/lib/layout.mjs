/**
 * 落地页公用外壳：head / 导航 / 页脚 / JSON-LD。
 *
 * 站点详情页在 docs/sites/<id>/，比根目录深两层，所以站内链接一律用 base 前缀拼，
 * 别在各个渲染器里各写一套相对路径。样式沿用「内联进 HTML」的做法：
 * 单文件转发到社群不掉样式，也省掉一次请求。
 */
import { language, languageNav, languageAlternates } from './locales.mjs';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function fmt(iso) {
  if (!iso) return '未知';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** 站内导航：新页面只有被链接到才有 SEO 价值，六个页面互相链上 */
export const NAV = [
  { href: '', label: '站点总览' },
  { href: 'compare/', label: '按次 vs 按量' },
  { href: 'status/', label: '可用性' },
  { href: 'changelog/', label: '变动日志' },
];

function navBar(base, current, locale, copy) {
  const links = copy ? [
    { href: language(locale).path, label: copy.overview },
    { href: 'compare/', label: copy.compareZh },
    { href: 'status/', label: copy.statusZh },
    { href: 'changelog/', label: copy.historyZh },
  ] : NAV;
  const items = links.map((n) => {
    const active = n.href === current;
    return `<a class="navlink${active ? ' active' : ''}" href="${esc(base + n.href)}">${esc(n.label)}</a>`;
  });
  return `<nav class="nav${copy ? ' localized-nav' : ''}"><div class="wrap navrow">${items.join('')}<span class="navspace"></span><a class="navlink" href="${esc(
    `${base}feed.xml`,
  )}">${esc(copy?.feedZh ?? 'Atom 订阅')}</a></div></nav>`;
}

/**
 * JSON-LD：把 < > & 转成 \uXXXX。
 * 一是防止正文里的 </script> 提前闭合脚本块（整页结构化数据会静默失效），
 * 二是站点名 / 公告里的尖括号不会以原样 HTML 出现在页面源码里。转义后仍是合法 JSON，值不变。
 */
const ld = (data) =>
  JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/**
 * 内联 SVG favicon：不多一次请求、不多一个文件；以前每页都去请求 /favicon.ico 吃 404。
 * 配色就是样式表里的 --accent → --accent-2。
 */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
    "<stop offset='0' stop-color='#7c5cff'/><stop offset='1' stop-color='#22d3ee'/></linearGradient></defs>" +
    "<rect width='64' height='64' rx='16' fill='url(#g)'/><path d='M37 8 16 37h13l-3 19 22-29H35z' fill='#fff'/></svg>",
)}`;

/**
 * 分享卡片：链接主要靠转发到 Telegram / 微信 / X 传播，以前声明了 summary_large_image 却没给图，
 * 预览只剩一行标题。图是 docs/assets/og.png（源文件 scripts/og-card.html），不含实时数字，不会过时。
 */
const OG_IMAGE = { path: 'assets/og.png', width: 1200, height: 630 };

export function pageShell({ meta, css, title, desc, canonical, base = '', current = '', jsonLd = [], body, live, noindex = false, locale = 'zh-CN', copy = null, languagePath = null }) {
  const lang = language(locale); // Reject invalid locale metadata instead of silently rendering the wrong language.
  const feed = `${meta.pagesUrl}feed.xml`;
  const ogImage = `${(meta.pagesUrl ?? '').replace(/\/?$/, '/')}${OG_IMAGE.path}`;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a0c11">
<meta name="color-scheme" content="dark">
<link rel="icon" href="${FAVICON}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="keywords" content="${esc(copy ? [copy.title, 'Claude Code', 'Codex', 'Cursor', 'API'].join(',') : (meta.keywords ?? []).join(','))}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(meta.title)}">
<meta property="og:locale" content="${lang.og}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="${OG_IMAGE.width}">
<meta property="og:image:height" content="${OG_IMAGE.height}">
<meta property="og:image:alt" content="${esc(`${meta.title}：${meta.tagline}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/atom+xml" title="${esc(copy?.historyZh ?? '变动日志')}" href="${esc(feed)}">
${languagePath !== null ? languageAlternates(meta.pagesUrl, languagePath) : ''}
${jsonLd.length ? `<script type="application/ld+json">${ld(jsonLd.length === 1 ? jsonLd[0] : jsonLd)}</script>` : ''}
${css ? `<style>\n${css}</style>` : `<link rel="stylesheet" href="${esc(base)}assets/style.css">`}
</head>
<body>
${navBar(base, current, locale, copy)}
<div class="wrap">
${languageNav({ locale, base, path: languagePath ?? '', label: copy?.language })}
${body}
  <footer>
    ${copy ? `<h2>${esc(copy.safety)}</h2><ul>${copy.disclaimer.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    <p>${esc(copy.updated)}: ${esc(live?.generatedAt ? fmt(live.generatedAt) : copy.unknown)} · <a href="${esc(meta.repoUrl)}">${esc(copy.repository)}</a> · <a href="${esc(feed)}">${esc(copy.feedZh)}</a></p>` : `
    <ul>
      <li>本页包含<strong>邀请链接</strong>，邀请奖励、领取条件与免费范围以各站活动规则为准，不保证注册即有奖励。</li>
      <li>本站只做信息聚合，与各站点无隶属关系，不代收费用、不承诺可用性；公益站可能随时改规则或关站。</li>
      <li>请勿把生产密钥、隐私数据、企业代码交给来源不明的中转服务；重要项目请使用官方 API。</li>
      <li>请遵守各站点与上游服务商条款，禁止批量注册、刷量、转售额度。</li>
    </ul>
    <p>数据快照时间：${esc(fmt(live?.generatedAt))} · 由 <a href="${esc(meta.repoUrl)}">${esc(
      meta.repoUrl.replace(/^https:\/\//, ''),
    )}</a> 自动生成 · <a href="${esc(feed)}">Atom 订阅</a></p>`}
  </footer>
</div>
</body>
</html>
`;
}

/**
 * 「复制配置」按钮，首页卡片和站点详情页共用（按钮紧跟在 <pre> 后面）。
 * 链接多半是转发到微信 / QQ 群里打开的，这些内置浏览器常常没有 navigator.clipboard，
 * 以前直接调用会抛错，点了没有任何反应。退回 execCommand('copy')，再不行就把代码选中、提示长按复制。
 */
export const COPY_SCRIPT = `<script>
document.querySelectorAll('.copy').forEach(function (btn) {
  var label = btn.textContent;
  function done(text) {
    btn.textContent = text;
    setTimeout(function () { btn.textContent = label; }, 1800);
  }
  function fallback(pre) {
    var range = document.createRange();
    range.selectNodeContents(pre);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    done(ok ? '已复制 ✓' : '已选中，请长按复制');
  }
  btn.addEventListener('click', function () {
    var pre = btn.previousElementSibling;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pre.innerText).then(function () { done('已复制 ✓'); }, function () { fallback(pre); });
    } else {
      fallback(pre);
    }
  });
});
</script>`;

/** 面包屑的结构化数据，让搜索结果里显示层级而不是一串裸 URL */
export function breadcrumb(meta, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

export function faqLd(pairs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}
