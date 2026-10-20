/** Translated guides share all numeric facts, routing and signup rules with the Chinese edition. */
import { creditPlan, usdTotals } from './credits.mjs';
import { activeSites, archivedSites, isArchived, archivedAt } from './archived.mjs';
import { signupRoute, acceptsNew } from './signup.mjs';
import { esc, fmt, pageShell, breadcrumb } from './layout.mjs';
import { language, readmeLanguages } from './locales.mjs';
import { communityReadme, communityBanner } from './community.mjs';

export const OCTOVERSE_URL = 'https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/';

export function interpolate(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Missing translation variable: ${key}`);
    return String(values[key]);
  });
}
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** Fail fast on missing text/variables so a refresh cannot publish half-translated pages. */
export function validateCatalog(catalog, reference, sites) {
  language(catalog.locale);
  function check(value, source, path) {
    if (typeof source === 'string') {
      if (typeof value !== 'string' || !value.trim() || placeholders(value) !== placeholders(source)) {
        throw new Error(`${catalog.locale}: invalid translation ${path}`);
      }
    } else {
      if (!value || Array.isArray(value) !== Array.isArray(source) || Object.keys(value).sort().join() !== Object.keys(source).sort().join()) {
        throw new Error(`${catalog.locale}: missing/extra keys at ${path}`);
      }
      for (const key of Object.keys(source)) check(value[key], source[key], `${path}.${key}`);
    }
  }
  check(catalog.ui, reference.ui, 'ui');
  for (const site of activeSites(sites)) {
    if (!reference.sites[site.id]) throw new Error(`en: missing site translation ${site.id}`);
    check(catalog.sites[site.id], reference.sites[site.id], `sites.${site.id}`);
  }
}

const md = (s) => esc(s).replace(/\|/g, '\\|').replace(/`/g, '&#96;').replace(/[\r\n]+/g, ' ');
const link = (url, label) => `<a href="${esc(url)}">${esc(label)}</a>`;
const paragraph = (text, cls = 'section-copy') => `<p class="${cls}">${esc(text)}</p>`;
const list = (items, tag = 'ul') => `<${tag} class="hl">${items.map((s) => `<li>${esc(s)}</li>`).join('')}</${tag}>`;
const date = (iso, ui) => iso ? fmt(iso) : ui.unknown;

function amount(value, plan, ui, approx = false) {
  if (value == null) return ui.unpublished;
  const prefix = approx ? '≈' : '';
  if (plan.unit === 'usd') return `${prefix}$${value}`;
  const unit = plan.unit === 'point' ? ui.points : plan.unit === 'site-usd' ? ui.siteUnits : plan.unit;
  return `${prefix}${value} ${unit}`;
}

function siteView(site, snap, catalog) {
  const ui = catalog.ui;
  const raw = catalog.sites[site.id];
  if (!raw) throw new Error(`${catalog.locale}: missing site ${site.id}`);
  const copy = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, interpolate(v, { inviteCode: site.inviteCode ?? '' })]));
  const plan = creditPlan(site, snap);
  const route = signupRoute(snap);
  const shut = route.state === 'closed';
  const sub = site.subscription;
  const first = sub ? `${sub.name} · ${interpolate(ui.perMonth, { amount: `$${sub.monthlyUsd}` })}` : amount(plan.firstDay, plan, ui, plan.approx);
  const daily = sub ? interpolate(ui.window, { hours: sub.windowHours })
    : plan.daily != null ? `${interpolate(ui.perDay, { amount: amount(plan.daily, plan, ui, plan.approx) })} · ${plan.resets ? ui.pool : ui.checkin}`
    : plan.dailyNote ? copy.dailyNote
    : snap?.checkinEnabled === true ? ui.checkinUnknown : snap?.checkinEnabled === false ? ui.noCheckin : ui.unpublished;
  const state = shut ? ui.closed : snap?.online === true ? ui.online : snap?.online === false ? ui.offline : ui.unknown;
  const facts = [
    [ui.firstDay, first],
    ...(!sub ? [
      plan.signup != null ? [ui.signup, amount(plan.signup, plan, ui)] : null,
      plan.invite != null ? [ui.invite, amount(plan.invite, plan, ui)] : null,
      [ui.daily, daily],
    ].filter(Boolean) : []),
    [ui.state, state],
    route.state === 'oauth' ? [ui.signup, interpolate(ui.oauth, { providers: route.oauth.join(' / ') })] : null,
    [ui.updated, date(snap?.staleFrom ?? snap?.checkedAt, ui)],
    site.remarks ? [ui.remarks, copy.remarks] : null,
  ].filter(Boolean);
  const warnings = [
    shut ? ui.closed : null,
    snap?.probeBlocked ? ui.blocked : null,
    snap?.dataStale || snap?.modelsSource === 'cached' ? interpolate(ui.cached, { at: date(snap.staleFrom ?? snap.checkedAt, ui) }) : null,
  ].filter(Boolean);
  return { site, snap, copy, plan, sub, route, shut, first, daily, state, facts, warnings };
}

function views(sites, live, catalog) {
  const byId = new Map((live?.sites ?? []).map((s) => [s.id, s]));
  return activeSites(sites).map((site) => siteView(site, byId.get(site.id), catalog));
}
function totalsText(items, ui) {
  const total = usdTotals(items.filter((v) => acceptsNew(v.snap)).map((v) => v.plan));
  return interpolate(ui.total, { amount: `$${total.total}`, count: total.count });
}
function planLines(v, ui) {
  if (!v.sub) return [];
  return [
    interpolate(ui.window, { hours: v.sub.windowHours }),
    ...v.sub.estimates.map((e) => `${e.model}: ${interpolate(ui.requests, { count: e.requests.toLocaleString('en-US') })}`),
    ui.planNote,
  ];
}
function modelRows(v) {
  return (v.snap?.models ?? []).map((m) => [
    m.name,
    m.fixedPrice == null && m.inputPerMTok != null ? `$${m.inputPerMTok}` : '—',
    m.fixedPrice == null && m.outputPerMTok != null ? `$${m.outputPerMTok}` : '—',
    m.fixedPrice != null ? `$${m.fixedPrice}` : '—',
    (m.protocols ?? []).join(' / ') || '—',
  ]);
}
const modelHeaders = (ui) => [ui.model, ui.input, ui.output, ui.requestPrice, ui.protocol];
function markdownTable(headers, rows) {
  return [`| ${headers.map(md).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function endpoints(v) {
  return Object.entries(v.site.endpoints ?? {}).filter(([, url]) => url)
    .map(([protocol, url]) => [protocol === 'anthropic' ? 'Anthropic Base URL' : 'OpenAI Base URL', url]);
}

function siteMarkdown(v, { meta, catalog }) {
  const ui = catalog.ui;
  const source = `${meta.pagesUrl}sites/${v.site.id}/`;
  const lines = [
    `## ${v.site.name}`, '', v.copy.summary, '',
    `[${v.shut ? ui.visitClosed : ui.visit}](${v.site.signupUrl}) · [${ui.details}](${meta.pagesUrl}${language(catalog.locale).path}sites/${v.site.id}/)`, '',
    ...v.warnings.map((text) => `> ${text}`), '',
    ...v.facts.map(([label, value], i) => `- **${label}**: ${i === 0 && v.shut ? `~~${value}~~` : value}`), '',
    ...planLines(v, ui).map((text) => `> ${text}`),
    ...(v.sub ? ['', `[${ui.officialPricing}](${v.sub.sourceUrl}) · ${ui.verified}: ${v.sub.verifiedAt}`] : []), '',
    `### ${ui.requirements}`, '', v.copy.registration, '',
    ...(v.site.inviteCode ? [`**${ui.inviteCode}: \`${v.site.inviteCode}\`**`, ''] : []),
    `### ${ui.notes}`, '', v.copy.notes, '',
    `### ${ui.setup}`, '', ui.setupNote, '',
    ...endpoints(v).map(([label, url]) => `- ${label}: \`${url}\``),
    ...(v.site.setup?.dashboardUrl ? [`- [${ui.dashboard}](${v.site.setup.dashboardUrl})`] : []),
    ...(v.site.docsUrl ? [`- [${ui.docs}](${v.site.docsUrl})`] : []),
    ...(v.site.mirrors ?? []).map((m) => `- [${ui.mirrors}: ${m.homeUrl}](${m.signupUrl})`), '',
    `### ${ui.models}`, '', ui.modelsNote, '',
    modelRows(v).length ? markdownTable(modelHeaders(ui), modelRows(v).map((row) => row.map(md))) : ui.unpublished, '',
    `[${ui.sourceZh}](${source})`,
  ];
  return lines.join('\n');
}

export function renderLocalizedReadme({ meta, sites, live, catalog }) {
  const ui = catalog.ui;
  const items = views(sites, live, catalog);
  const hasRemarks = items.some((v) => v.site.remarks);
  const rows = items.map((v) => [
    `**${md(v.site.name)}**`, md(v.state), v.shut ? `~~${md(v.first)}~~` : `**${md(v.first)}**`, md(v.daily),
    `[${md(v.shut ? ui.visitClosed : ui.visit)}](${v.site.signupUrl})`,
    ...(hasRemarks ? [md(v.site.remarks ? v.copy.remarks : '—')] : []),
  ]);
  return [
    `# ${ui.title}`, '', ...communityReadme(meta, ui), readmeLanguages(catalog.locale), '', ui.tagline, '',
    `[${ui.website}](${meta.pagesUrl}${language(catalog.locale).path}) · [${ui.repository}](${meta.repoUrl})`, '',
    '> [!TIP]', `> **📣 ${ui.submitTitle}**`, '>', `> ${ui.submitText}`, '>',
    `> [${ui.submit}](${meta.repoUrl}/issues/new/choose) · [${ui.browse}](${meta.repoUrl}/issues)`, '',
    ui.intro, '', `**${ui.updated}:** ${date(live?.generatedAt, ui)}`, '',
    `## ${ui.overview}`, '', markdownTable([ui.site, ui.state, ui.firstDay, ui.daily, ui.signup, ...(hasRemarks ? [ui.remarks] : [])], rows), '',
    `**${totalsText(items, ui)}**`, '', ui.totalsNote, '', ui.dataNote, '',
    `## ${ui.quickstart}`, '', ...ui.steps.map((s, i) => `${i + 1}. ${s}`), '',
    ...items.map((v) => siteMarkdown(v, { meta, catalog })), '',
    `## ${ui.archive}`, '', ui.archiveNote, '',
    ...archivedSites(sites).map((s) => `- [${s.id}](${meta.pagesUrl}sites/${s.id}/) · ${s.archived.at ?? ''}`), '',
    `## ${ui.safety}`, '', ...ui.disclaimer.map((s) => `- ${s}`), '',
    `## ${ui.maintenance}`, '', ui.maintenanceNote, '',
    `## ${ui.selection}`, '', ui.selectionNote, '', `[${ui.report}](${OCTOVERSE_URL})`, '',
  ].join('\n');
}

function factsHtml(v) {
  return `<dl class="kv">${v.facts.map(([label, value], i) => `<dt>${esc(label)}</dt><dd>${i === 0 ? `<b${v.shut ? ' class="struck"' : ''}>${esc(value)}</b>` : esc(value)}</dd>`).join('')}</dl>`;
}
function planHtml(v, ui) {
  return v.sub ? `<div class="subscription">${planLines(v, ui).map((s) => paragraph(s)).join('')}
    ${link(v.sub.sourceUrl, ui.officialPricing)} · ${esc(ui.verified)}: ${esc(v.sub.verifiedAt)}</div>` : '';
}
function callout(meta, ui) {
  return `<aside class="announce"><strong>📣 ${esc(ui.submitTitle)}</strong><span>${esc(ui.submitText)}</span>
    ${link(`${meta.repoUrl}/issues/new/choose`, ui.submit)} ${link(`${meta.repoUrl}/issues`, ui.browse)}</aside>`;
}
function button(v, ui) {
  return `<a class="btn btn-ghost" href="${esc(v.site.signupUrl)}">${esc(v.shut ? ui.visitClosed : ui.visit)} →</a>`;
}
function modelTable(v, ui) {
  const rows = modelRows(v);
  return rows.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(ui.models)}"><table>
    <caption>${esc(v.site.name)} — ${esc(ui.models)}</caption><thead><tr>${modelHeaders(ui).map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : paragraph(ui.unpublished);
}

export function renderLocalizedHome({ meta, sites, live, css, catalog }) {
  const ui = catalog.ui;
  const items = views(sites, live, catalog);
  const prefix = language(catalog.locale).path;
  const body = `<main class="localized">
    <header class="hero">${communityBanner(meta, ui, '../')}${callout(meta, ui)}<h1>${esc(ui.title)}</h1><p class="sub">${esc(ui.tagline)}</p>
    ${paragraph(ui.intro)}<p class="pill">${esc(ui.updated)}: ${esc(date(live?.generatedAt, ui))}</p>
    <p><strong>${esc(totalsText(items, ui))}</strong></p></header>
    <section aria-labelledby="overview"><h2 id="overview">${esc(ui.overview)}</h2>
      ${paragraph(ui.totalsNote)}${paragraph(ui.dataNote)}
      <div class="grid">${items.map((v) => `<article class="card${v.shut ? ' shut' : ''}" id="${esc(v.site.id)}">
        <h3>${link(`sites/${v.site.id}/`, v.site.name)}</h3><p class="desc">${esc(v.copy.summary)}</p>
        ${factsHtml(v)}${planHtml(v, ui)}${v.warnings.map((s) => paragraph(s, 'notice')).join('')}
        <div class="cta-row mt-auto">${button(v, ui)}${link(`sites/${v.site.id}/`, `${ui.details} →`)}</div></article>`).join('')}</div>
    </section>
    <section><h2>${esc(ui.quickstart)}</h2>${list(ui.steps, 'ol')}</section>
    <section><h2>${esc(ui.archive)}</h2>${paragraph(ui.archiveNote)}<ul>${archivedSites(sites).map((s) => `<li>${link(`../sites/${s.id}/`, s.id)} · ${esc(s.archived.at ?? '')}</li>`).join('')}</ul></section>
    <section><h2>${esc(ui.maintenance)}</h2>${paragraph(ui.maintenanceNote)}${link(meta.repoUrl, ui.repository)}</section>
    <section><h2>${esc(ui.selection)}</h2>${paragraph(ui.selectionNote)}${link(OCTOVERSE_URL, ui.report)}</section>
    </main>`;
  return pageShell({ meta, css, live, locale: catalog.locale, copy: ui, base: '../', current: prefix, languagePath: '',
    title: ui.title, desc: ui.tagline, canonical: `${meta.pagesUrl}${prefix}`, body,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: ui.title, inLanguage: catalog.locale,
      numberOfItems: items.length, itemListElement: items.map((v, i) => ({ '@type': 'ListItem', position: i + 1, name: v.site.name,
        description: v.copy.summary, url: `${meta.pagesUrl}${prefix}sites/${v.site.id}/` })) }],
  });
}

export function renderLocalizedSite({ meta, site, snap, live, css, catalog }) {
  const ui = catalog.ui;
  const prefix = language(catalog.locale).path;
  const canonical = `${meta.pagesUrl}${prefix}sites/${site.id}/`;
  // Always overwrite previous translated listings when a service is archived.
  if (isArchived(site)) return pageShell({ meta, css, live, locale: catalog.locale, copy: ui,
    base: '../../../', current: prefix, title: `${site.id} — ${ui.archive}`, desc: ui.archiveNote,
    canonical, noindex: true, body: `<main class="localized"><header class="hero"><h1>${esc(site.id)}</h1>
    <p>${esc(ui.archive)} · ${esc(archivedAt(site) ?? '')}</p></header>${paragraph(ui.archiveNote)}
    ${paragraphLink(`${meta.pagesUrl}sites/${site.id}/`, ui.sourceZh)}</main>` });
  const v = siteView(site, snap, catalog);
  const body = `<main class="localized">
    <header class="hero"><p class="crumb">${link('../../', ui.overview)} / ${esc(site.name)}</p>
      <h1>${esc(site.name)}</h1><p class="sub">${esc(v.copy.summary)}</p>${button(v, ui)}
      ${v.warnings.map((s) => paragraph(s, 'notice')).join('')}</header>
    <section><h2>${esc(ui.firstDay)}</h2>${factsHtml(v)}${planHtml(v, ui)}${paragraph(ui.dataNote)}</section>
    <section><h2>${esc(ui.requirements)}</h2>${paragraph(v.copy.registration)}
      ${site.inviteCode ? `<p class="notice">${esc(ui.inviteCode)}: <code>${esc(site.inviteCode)}</code></p>` : ''}</section>
    <section><h2>${esc(ui.notes)}</h2>${paragraph(v.copy.notes)}</section>
    <section><h2>${esc(ui.setup)}</h2>${paragraph(ui.setupNote)}
      ${endpoints(v).map(([label, url]) => `<p>${esc(label)}</p><pre><code>${esc(url)}</code></pre>`).join('')}
      ${site.setup?.dashboardUrl ? paragraphLink(site.setup.dashboardUrl, ui.dashboard) : ''}
      ${site.docsUrl ? paragraphLink(site.docsUrl, ui.docs) : ''}
      ${(site.mirrors ?? []).map((m) => paragraphLink(m.signupUrl, `${ui.mirrors}: ${m.homeUrl}`)).join('')}</section>
    <section><h2>${esc(ui.models)}</h2>${paragraph(ui.modelsNote)}${modelTable(v, ui)}</section>
    <section><h2>${esc(ui.sourceZh)}</h2>${paragraphLink(`${meta.pagesUrl}sites/${site.id}/`, ui.sourceZh)}</section>
    ${callout(meta, ui)}</main>`;
  return pageShell({ meta, css, live, locale: catalog.locale, copy: ui, base: '../../../', current: prefix,
    languagePath: `sites/${site.id}/`, title: `${site.name} — ${ui.title}`, desc: v.copy.summary, canonical, body,
    jsonLd: [breadcrumb(meta, [{ name: ui.title, url: `${meta.pagesUrl}${prefix}` }, { name: site.name, url: canonical }])],
  });
}
function paragraphLink(url, label) { return `<p>${link(url, label)}</p>`; }
