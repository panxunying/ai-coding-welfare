#!/usr/bin/env node
/**
 * 零依赖单测：node scripts/test.mjs
 * 盯的是线上真实踩过的坑——CI 机房 IP 被 Cloudflare 拦时，页面不能退化成「异常 + 无数据」。
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mergeSnapshot, meaningful } from './lib/merge.mjs';
import { pickPreferred, staleHours, STALE_WARN_HOURS, blankSnapshot, looksFiltered, probeUrl, isHttpsUrl, fetchJson, describeFetchError } from './lib/newapi.mjs';
import { creditPlan, usd, breakdown, perDay, auditCredits, usdTotals, othersNote } from './lib/credits.mjs';
import { PANELS, probeSite } from './lib/panels.mjs';
import { diffSite, diffSnapshots, majorOnly, priceLabel } from './lib/diff.mjs';
import { appendSample, compact, uptime, byDay, coverage, ciBaseline, EMPTY_HISTORY } from './lib/history.mjs';
import { groupByDay, renderAtom, summarize, icon } from './lib/changelog.mjs';
import { renderSitePage } from './lib/render-site-page.mjs';
import { renderComparePage, renderStatusPage, renderChangelogPage, estimateTurns } from './lib/render-aux-pages.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { renderReadme } from './lib/render-readme.mjs';
import { signupRoute, acceptsNew, signupProbeUrl } from './lib/signup.mjs';
import { isArchived, activeSites, archivedSites, archivedAt, archivedReason } from './lib/archived.mjs';
import { telegramText } from './lib/telegram.mjs';
import { subscriptionPlan, renderSubscription } from './lib/subscription.mjs';
import { LANGUAGES, TRANSLATED_LANGUAGES, language, languageNav } from './lib/locales.mjs';
import { validateCatalog, interpolate, renderLocalizedReadme, renderLocalizedHome, renderLocalizedSite } from './lib/render-localized.mjs';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    console.error(`  ✘ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const HOUR = 3_600_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

const OLD_GOOD = {
  id: 'agentrouter',
  checkedAt: iso(6 * HOUR),
  apiOk: true,
  pricingOk: true,
  latencyMs: 378,
  error: null,
  systemName: 'Agent Router',
  version: 'init-20260820-c6931bb5',
  registerOpen: true,
  checkinEnabled: null,
  loginMethods: ['GitHub', 'LinuxDO'],
  quotaPerUnit: 500000,
  inviteeBonusUsd: 50,
  inviterBonusUsd: 150,
  announcements: [{ id: 1, date: '2026-08-20', text: '公告' }],
  models: [{ name: 'claude-opus-4-8' }, { name: 'claude-opus-5' }, { name: 'gpt-5.6-sol' }],
  modelsSource: 'public-api',
  signup: { status: 200, ok: true, ms: 300 },
  mirrors: [{ homeUrl: 'https://ps.air-outer.com', online: true }],
  defaults: { claude: 'claude-opus-5', openai: 'gpt-5.6-sol' },
  online: true,
};

/** 模拟 Cloudflare 挑战：HTTP 200 但不是 JSON，于是所有内容字段都是空的 */
const FRESH_BLOCKED = {
  id: 'agentrouter',
  checkedAt: iso(0),
  apiOk: false,
  pricingOk: false,
  latencyMs: 1219,
  error: 'invalid json',
  systemName: null,
  version: null,
  registerOpen: null,
  checkinEnabled: null,
  loginMethods: [],
  quotaPerUnit: null,
  inviteeBonusUsd: null,
  inviterBonusUsd: null,
  announcements: [],
  models: [],
  modelsSource: 'login-required',
  defaults: { claude: null, openai: null },
  signup: { status: 200, ok: true, ms: 412 },
  mirrors: [{ homeUrl: 'https://ps.air-outer.com', online: false }],
};

console.log('mergeSnapshot：接口被拦时保住已知数据');
{
  const m = mergeSnapshot(FRESH_BLOCKED, OLD_GOOD);
  test('站名 / 版本 / 邀请额度 沿用旧值，不会变成 null', () => {
    assert.equal(m.systemName, 'Agent Router');
    assert.equal(m.version, 'init-20260820-c6931bb5');
    assert.equal(m.inviteeBonusUsd, 50);
    assert.equal(m.inviterBonusUsd, 150);
    assert.deepEqual(m.loginMethods, ['GitHub', 'LinuxDO']);
  });
  test('模型清单沿用旧值并标注 cached', () => {
    assert.equal(m.models.length, 3);
    assert.equal(m.modelsSource, 'cached');
  });
  test('默认模型按合并后的清单重算（版本最新的赢）', () => {
    assert.equal(m.defaults.claude, 'claude-opus-5');
    assert.equal(m.defaults.openai, 'gpt-5.6-sol');
  });
  test('注册页 200 → 仍算在线，不显示「异常」', () => {
    assert.equal(m.online, true);
  });
  test('探测元信息用本次的真实结果', () => {
    assert.equal(m.apiOk, false);
    assert.equal(m.error, 'invalid json');
    assert.equal(m.latencyMs, 1219);
    assert.equal(m.checkedAt, FRESH_BLOCKED.checkedAt);
    assert.equal(m.mirrors[0].online, false);
  });
  test('标记 dataStale + staleFrom 指向旧快照时间', () => {
    assert.equal(m.dataStale, true);
    assert.equal(m.staleFrom, OLD_GOOD.checkedAt);
    assert.ok(m.staleFields.includes('systemName') && m.staleFields.includes('models'));
  });
  test('6 小时内的快照不在页面上报警', () => {
    assert.equal(staleHours(m), null);
  });
  test(`超过 ${STALE_WARN_HOURS} 小时才报警，并给出小时数`, () => {
    const long = mergeSnapshot(FRESH_BLOCKED, { ...OLD_GOOD, checkedAt: iso(72 * HOUR) });
    assert.equal(staleHours(long), 72);
  });
}

console.log('mergeSnapshot：其它路径');
test('抓取成功时新值覆盖旧值，且不标 stale', () => {
  const fresh = { ...OLD_GOOD, checkedAt: iso(0), systemName: 'Agent Router 2', inviteeBonusUsd: 30, models: [{ name: 'claude-opus-5' }] };
  const m = mergeSnapshot(fresh, OLD_GOOD);
  assert.equal(m.systemName, 'Agent Router 2');
  assert.equal(m.inviteeBonusUsd, 30);
  assert.equal(m.models.length, 1);
  assert.equal(m.modelsSource, 'public-api');
  assert.equal(m.dataStale, false);
  assert.equal(m.staleFrom, null);
});
test('status 通了但 pricing 被拦：模型沿用旧值，站名用新值', () => {
  const fresh = { ...FRESH_BLOCKED, apiOk: true, error: null, systemName: 'Agent Router', inviteeBonusUsd: 50 };
  const m = mergeSnapshot(fresh, OLD_GOOD);
  assert.equal(m.online, true);
  assert.equal(m.models.length, 3);
  assert.equal(m.modelsSource, 'cached');
  assert.equal(m.dataStale, true);
});
test('首次抓取（没有旧快照）不会因为 old 缺失而炸', () => {
  const m = mergeSnapshot(FRESH_BLOCKED, undefined);
  assert.equal(m.systemName, null);
  assert.equal(m.models.length, 0);
  assert.equal(m.dataStale, false);
  assert.equal(m.defaults.claude, null);
  assert.equal(m.online, true); // 注册页可访问
});
test('注册页也不通 → 如实标记异常', () => {
  const m = mergeSnapshot({ ...FRESH_BLOCKED, signup: { status: 0, ok: false, ms: 20000, error: 'timeout' } }, OLD_GOOD);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});

console.log('mergeSnapshot：区分「被 WAF 拦」和「站点真挂了」');
/** CI 机房 IP 的典型样子：接口和注册页一起吃 403，本机访问同一个域名全是 200 */
const ALL_403 = { ...FRESH_BLOCKED, error: 'HTTP 403', signup: { status: 403, ok: false, ms: 210 } };

test('整站 403 且上次是在线的 → 仍算在线，标 probeBlocked', () => {
  const m = mergeSnapshot(ALL_403, OLD_GOOD);
  assert.equal(m.online, true);
  assert.equal(m.probeBlocked, true);
  assert.equal(m.systemName, 'Agent Router'); // 数据照旧沿用
  assert.equal(m.dataStale, true);
});
test('429 / 503 / 挑战页同样按被拦处理', () => {
  for (const [error, signup] of [
    ['HTTP 429', { status: 429, ok: false, ms: 90 }],
    ['HTTP 503', { status: 503, ok: false, ms: 90 }],
    ['invalid json', { status: 200, ok: false, ms: 90, error: 'invalid json' }],
  ]) {
    const m = mergeSnapshot({ ...ALL_403, error, signup }, OLD_GOOD);
    assert.equal(m.online, true, error);
    assert.equal(m.probeBlocked, true, error);
  }
});
test('超时 / 连不上 / 502 是真下线，不许拿「可能被拦」兜底', () => {
  for (const [error, signup] of [
    ['timeout', { status: 0, ok: false, ms: 20000, error: 'timeout' }],
    ['HTTP 502', { status: 502, ok: false, ms: 90 }],
    ['HTTP 404', { status: 404, ok: false, ms: 90 }],
  ]) {
    const m = mergeSnapshot({ ...ALL_403, error, signup }, OLD_GOOD);
    assert.equal(m.online, false, error);
    assert.equal(m.probeBlocked, false, error);
  }
});
test('接口被拦但注册页超时 → 混着算真下线', () => {
  const m = mergeSnapshot({ ...ALL_403, signup: { status: 0, ok: false, ms: 20000, error: 'timeout' } }, OLD_GOOD);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});
test('旧快照超过 48 小时还是只有 403 → 不再兜底，如实标异常', () => {
  const m = mergeSnapshot(ALL_403, { ...OLD_GOOD, checkedAt: iso(72 * HOUR) });
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});
test('连续被拦：staleFrom 粘在最后一次成功的时间，不跟着 checkedAt 往后跑', () => {
  const once = mergeSnapshot(ALL_403, OLD_GOOD);
  const twice = mergeSnapshot({ ...ALL_403, checkedAt: iso(0) }, once);
  assert.equal(once.staleFrom, OLD_GOOD.checkedAt);
  assert.equal(twice.staleFrom, OLD_GOOD.checkedAt);
  assert.equal(twice.online, true);
});
test('连续被拦超过 48 小时（checkedAt 每次都在刷新）→ 依旧会翻成异常', () => {
  const blockedLong = { ...OLD_GOOD, checkedAt: iso(0), online: true, staleFrom: iso(60 * HOUR), dataStale: true };
  const m = mergeSnapshot(ALL_403, blockedLong);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
  assert.equal(staleHours(m), 60);
});
test('从没成功过的站点被 403 → 没有「上次在线」可沿用，标异常', () => {
  const m = mergeSnapshot(ALL_403, undefined);
  assert.equal(m.online, false);
  assert.equal(m.probeBlocked, false);
});
test('本次探通了就不该标 probeBlocked', () => {
  assert.equal(mergeSnapshot(FRESH_BLOCKED, OLD_GOOD).probeBlocked, false); // 注册页 200
  assert.equal(mergeSnapshot({ ...OLD_GOOD, checkedAt: iso(0) }, OLD_GOOD).probeBlocked, false);
});
test('looksFiltered 只认「服务器答话了但把我们拦了」', () => {
  for (const r of [{ status: 403 }, { status: 429 }, { status: 451 }, { status: 503 }, { status: 200, error: 'invalid json' }]) {
    assert.equal(looksFiltered(r), true, JSON.stringify(r));
  }
  for (const r of [null, { ok: true, status: 200 }, { status: 0, error: 'timeout' }, { status: 502 }, { status: 404 }]) {
    assert.equal(looksFiltered(r), false, JSON.stringify(r));
  }
});

console.log('额度口径 creditPlan');
const AR = { id: 'agentrouter', name: 'AgentRouter', credits: { signup: 100, invite: 50, dailyCheckin: 25, approx: false } };
const JD = { id: 'justdowork', name: 'JustDoWork', credits: { signup: 70, invite: null, dailyCheckin: 22, approx: true } };
const RC = { id: 'rawchat', name: 'RawChat 公益站', credits: { signup: null, invite: null, dailyCheckin: null, dailyQuota: 50 } };

test('AgentRouter：100 注册 + 50 邀请 + 25 签到 = 首日 175', () => {
  const p = creditPlan(AR, OLD_GOOD);
  assert.equal(p.base, 150);
  assert.equal(p.firstDay, 175);
  assert.equal(usd(p.firstDay, p.approx), '$175');
  assert.equal(breakdown(p), '注册 $100 + 本页邀请 $50 + 首签 $25');
});
test('AgentRouter：登记的邀请额度与接口实测 $50 一致', () => {
  const p = creditPlan(AR, OLD_GOOD);
  assert.equal(p.apiInvite, 50);
  assert.equal(p.invite, p.apiInvite);
  assert.deepEqual(auditCredits([AR], { sites: [OLD_GOOD] }), []);
});
test('JustDoWork：70 + 约 22 = 首日约 92，带 ≈ 前缀', () => {
  const p = creditPlan(JD, { id: 'justdowork' });
  assert.equal(p.firstDay, 92);
  assert.equal(usd(p.firstDay, p.approx), '≈$92');
  assert.equal(breakdown(p), '注册 $70 + 首签 ≈$22');
});
test('接口把邀请额度改了 → auditCredits 告警，提醒更新登记值', () => {
  const w = auditCredits([AR], { sites: [{ ...OLD_GOOD, inviteeBonusUsd: 30 }] });
  assert.equal(w.length, 1);
  assert.match(w[0], /登记邀请额度 \$50.*返回 \$30/);
});
test('AgentRouter：签到额度是累积的，措辞是「首签」而不是「重置」', () => {
  const p = creditPlan(AR, OLD_GOOD);
  assert.equal(p.resets, false);
  assert.equal(perDay(p), '$25/天');
});
test('RawChat：每日重置额度池 $50 → 首日 $50，且说明不累积', () => {
  const p = creditPlan(RC, null);
  assert.equal(p.firstDay, 50);
  assert.equal(p.daily, 50);
  assert.equal(p.resets, true);
  assert.equal(p.base, null);
  assert.equal(perDay(p), '$50/天（重置）');
  assert.equal(breakdown(p), '每日额度池 $50（每天重置，不累积）');
});
test('dailyCheckin 与 dailyQuota 同时填 → 按签到算并告警', () => {
  const both = { id: 'both', name: 'Both', credits: { signup: 10, dailyCheckin: 5, dailyQuota: 50 } };
  const p = creditPlan(both, null);
  assert.equal(p.daily, 5);
  assert.equal(p.resets, false);
  assert.match(auditCredits([both], { sites: [] }).join(''), /口径不同/);
});
test('没填 credits 的站点不炸，只告警', () => {
  const p = creditPlan({ id: 'x', name: 'X' }, null);
  assert.equal(p.firstDay, null);
  assert.equal(usd(p.firstDay), null);
  assert.equal(breakdown(p), null);
  assert.equal(perDay(p), null);
  assert.equal(auditCredits([{ id: 'x', name: 'X' }], { sites: [] }).length, 1);
});

console.log('计价单位：积分站不能被当成美元站');
const MX = { id: 'matrix', name: 'Matrix', credits: { signup: null, invite: 600, dailyCheckin: null, approx: false, unit: 'point' } };

test('Matrix：600 积分按积分显示，绝不擅自加 $', () => {
  const p = creditPlan(MX, null);
  assert.equal(p.unit, 'point');
  assert.equal(p.firstDay, 600);
  assert.equal(usd(p.firstDay, p.approx, p.unit), '600 积分');
  assert.equal(breakdown(p), '本页邀请 600 积分');
  assert.equal(perDay(p), null); // 没有签到、也没有每日额度池
});
test('sources 数出首日额度由几笔钱凑成，只有一笔时页面不重复说构成', () => {
  assert.equal(creditPlan(AR, OLD_GOOD).sources, 3);
  assert.equal(creditPlan(JD, null).sources, 2);
  assert.equal(creditPlan(RC, null).sources, 1);
  assert.equal(creditPlan(MX, null).sources, 1);
  assert.equal(creditPlan({ id: 'x', name: 'X' }, null).sources, 0);
});
test('跨站合计只算美元站，积分站单独说一句', () => {
  const plans = [creditPlan(AR, OLD_GOOD), creditPlan(JD, null), creditPlan(RC, null), creditPlan(MX, null)];
  const t = usdTotals(plans);
  assert.equal(t.count, 3);
  assert.equal(t.best, 175);
  assert.equal(t.total, 175 + 92 + 50);
  assert.equal(t.resetting, true);
  assert.equal(t.others.length, 1);
  assert.equal(othersNote(t.others), 'Matrix 另发 600 积分');
  assert.equal(othersNote([]), null);
});
test('积分站不拿接口的美元邀请额度对账，避免误报', () => {
  assert.deepEqual(auditCredits([MX], { sites: [{ id: 'matrix', inviteeBonusUsd: 30 }] }), []);
});
test('未登记的单位原样后缀显示，并告警提醒补 UNITS', () => {
  const odd = { id: 'odd', name: 'Odd', credits: { signup: 5, unit: 'credit' } };
  assert.equal(usd(5, false, 'credit'), '5 credit');
  assert.match(auditCredits([odd], { sites: [] }).join(''), /不在已知单位/);
});
/** DoCode 的「刀」是站内计价单位：面板 price=0.02（1 元 = 50 刀），和 ¥7.3 ≈ $1 的站差两个数量级 */
const DC = { id: 'docode', name: 'DoCode', credits: { signup: 50, invite: 250, dailyCheckin: null, approx: false, unit: 'site-usd' } };

test('站内刀按「站内刀」显示，不加 $、不并进美元合计', () => {
  const p = creditPlan(DC, null);
  assert.equal(p.firstDay, 300);
  assert.equal(usd(p.firstDay, p.approx, p.unit), '300 站内刀');
  assert.equal(breakdown(p), '注册 50 站内刀 + 本页邀请 250 站内刀');
  const t = usdTotals([creditPlan(AR, OLD_GOOD), creditPlan(DC, null)]);
  assert.equal(t.count, 1);
  assert.equal(t.total, 175); // 300 站内刀不许加进来
  assert.equal(othersNote(t.others), 'DoCode 另发 300 站内刀');
  assert.deepEqual(auditCredits([DC], { sites: [] }), []); // 已登记的单位不该告警
});
test('新收录事件按站点自己的单位写额度，不硬拼 $', () => {
  const [ev] = diffSnapshots({ sites: [] }, { generatedAt: iso(0), sites: [{ id: 'docode' }] }, [DC]);
  assert.equal(ev.text, '新收录 DoCode：注册送 50 站内刀，邀请再加 250 站内刀');
});

console.log('vibe-code 面板（Codex 公益站，接口不是 New API）');
/** 2026-08-21 从 new.sharedchat.cc 实测抓到的返回体 */
const VC_SITE = { id: 'rawchat', panel: 'vibecode', statusApi: 'https://new.sharedchat.cc/frontend-api/getConfig' };
const VC_CONFIG = {
  code: 1,
  msg: 'success',
  data: { siteName: 'RawChat公益站', siteType: 'codex', isAuth: false, isAuthClaude: false, isAuthCodex: true, isAuthGemini: false },
};
const VC_LOGIN = {
  code: 1,
  msg: 'success',
  data: {
    notice: '  每日 0 点重置额度  ',
    isEnableRegister: true,
    isEnableMailRegister: true,
    isEnableGitHubLogin: false,
    isEnableLinuxDoLogin: false,
    siteName: 'RawChat公益站',
    backendVersion: '1.0.0.0',
  },
};
const vcFetch = (map) => async (url) => map[String(url)] ?? { ok: false, error: 'unreachable' };
const VC_OK = vcFetch({
  'https://new.sharedchat.cc/frontend-api/getConfig': { ok: true, status: 200, ms: 587, json: VC_CONFIG },
  'https://new.sharedchat.cc/frontend-api/getLoginConfig': { ok: true, status: 200, ms: 431, json: VC_LOGIN },
});
const VC_CLOSED = { ok: true, status: 200, ms: 300, json: { code: 0, msg: '该接口未接入公益站独立网关，旧转发链路已关闭', data: null } };

// 探测本身是异步的，先在顶层 await 出结果，断言保持同步，测试运行器就不用管 Promise
const vcGood = await probeSite(VC_SITE, VC_OK);
const vcClosed = await probeSite(VC_SITE, vcFetch({
  'https://new.sharedchat.cc/frontend-api/getConfig': VC_CLOSED,
  'https://new.sharedchat.cc/frontend-api/getLoginConfig': VC_CLOSED,
}));
const vcUnreachable = await probeSite(VC_SITE, vcFetch({}));

test('站名 / 版本 / 注册开关 / 登录方式 / 已开放服务 都取到了', () => {
  assert.equal(vcGood.apiOk, true);
  assert.equal(vcGood.error, null);
  assert.equal(vcGood.systemName, 'RawChat公益站');
  assert.equal(vcGood.version, '1.0.0.0');
  assert.equal(vcGood.registerOpen, true);
  assert.deepEqual(vcGood.loginMethods, ['邮箱']);
  assert.deepEqual(vcGood.services, ['Codex']);
  assert.equal(vcGood.latencyMs, 587);
});
test('站内公告取自 notice，模型清单为空且标注需登录', () => {
  assert.deepEqual(vcGood.announcements, [{ id: null, date: null, text: '每日 0 点重置额度' }]);
  assert.deepEqual(vcGood.models, []);
  assert.equal(vcGood.modelsSource, 'login-required');
});
test('快照字段集合与 New API 面板完全一致（否则 merge 会漏字段）', () => {
  assert.deepEqual(Object.keys(vcGood).sort(), Object.keys(blankSnapshot(VC_SITE, {})).sort());
});
test('HTTP 200 但 code=0（接口未开放）→ 不当数据用，如实报错', () => {
  assert.equal(vcClosed.apiOk, false);
  assert.match(vcClosed.error, /旧转发链路已关闭/);
  assert.equal(vcClosed.systemName, null);
  assert.deepEqual(vcClosed.services, []);
});
test('vibe-code 接口被拦时，也走同一套字段级合并保住旧数据', () => {
  const m = mergeSnapshot({ ...vcUnreachable, signup: { status: 200, ok: true, ms: 210 } }, vcGood);
  assert.equal(m.online, true);
  assert.equal(m.systemName, 'RawChat公益站');
  assert.deepEqual(m.services, ['Codex']);
  assert.equal(m.dataStale, true);
});
test('panel 缺省是 newapi，未知 panel 直接报错而不是静默出空页', () => {
  assert.equal(PANELS.newapi.name, 'probeNewApi');
  assert.equal(PANELS.vibecode.name, 'probeVibeCode');
  assert.equal(PANELS.matrix.name, 'probeMatrix');
  assert.throws(() => probeSite({ id: 'z', panel: 'nope' }), /未知的面板类型/);
});

console.log('matrix 面板（公开接口只有一个健康检查，其余一律不猜）');
/** 2026-08-26 从 matrix.mzsjai.com/api/health 实测抓到的返回体 */
const MX_SITE = { id: 'matrix', panel: 'matrix', statusApi: 'https://matrix.mzsjai.com/api/health' };
const MX_HEALTH = { status: 'ok', timestamp: '2026-08-26T11:19:00.504Z' };
const mxFetch = (res) => async (url) => (String(url) === MX_SITE.statusApi ? res : { ok: false, error: 'unreachable' });

const mxGood = await probeSite(MX_SITE, mxFetch({ ok: true, status: 200, ms: 264, json: MX_HEALTH }));
const mxDegraded = await probeSite(MX_SITE, mxFetch({ ok: true, status: 200, ms: 311, json: { status: 'degraded' } }));
const mxNoField = await probeSite(MX_SITE, mxFetch({ ok: true, status: 200, ms: 120, json: { hello: 1 } }));
const mxDown = await probeSite(MX_SITE, mxFetch({ ok: false, status: 0, ms: 20_000, error: 'timeout' }));

test('health 返回 status=ok → apiOk，延迟如实记录', () => {
  assert.equal(mxGood.apiOk, true);
  assert.equal(mxGood.error, null);
  assert.equal(mxGood.latencyMs, 264);
});
test('接口给不出的字段一律留空，不从 sites.json 倒灌假装是探测结果', () => {
  assert.equal(mxGood.systemName, null);
  assert.equal(mxGood.version, null);
  assert.equal(mxGood.registerOpen, null);
  assert.equal(mxGood.checkinEnabled, null);
  assert.equal(mxGood.inviteeBonusUsd, null);
  assert.deepEqual(mxGood.loginMethods, []);
  assert.deepEqual(mxGood.models, []);
  assert.equal(mxGood.modelsSource, 'login-required');
  assert.equal(mxGood.pricingOk, false);
});
test('后端自报 degraded / 缺 status 字段 → 不当在线用，原因写进 error', () => {
  assert.equal(mxDegraded.apiOk, false);
  assert.match(mxDegraded.error, /degraded/);
  assert.equal(mxNoField.apiOk, false);
  assert.match(mxNoField.error, /没有 status 字段/);
});
test('连不上就是连不上，错误原样带出来', () => {
  assert.equal(mxDown.apiOk, false);
  assert.equal(mxDown.error, 'timeout');
  assert.equal(mxDown.latencyMs, 20_000);
});
test('matrix 快照字段集合与 New API 面板完全一致（否则 merge 会漏字段）', () => {
  assert.deepEqual(Object.keys(mxGood).sort(), Object.keys(blankSnapshot(MX_SITE, {})).sort());
});
test('health 挂了但注册页 200 → 页面仍算在线，不误报异常', () => {
  const m = mergeSnapshot({ ...mxDown, signup: { status: 200, ok: true, ms: 180 } }, mxGood);
  assert.equal(m.online, true);
  assert.equal(m.apiOk, false);
  assert.equal(m.error, 'timeout');
});

console.log('relay 面板（robots 禁 /api，只能探中转口或落地页）');
/**
 * 2026-09-01 实测：api.cheapcodex.online 的 robots.txt 是 Allow: / + Disallow: /api，
 * 面板接口按规矩不碰；robots 放行的 /v1/models 不带 key 必然回 401：
 *   {"code":"API_KEY_REQUIRED","message":"API key is required in Authorization header (Bearer scheme), …"}
 * probeUrl 只给 { status, ok, ms }，看不到 body——所以口径就是「401 = 活着且要鉴权」。
 */
const RL_SITE = { id: 'cheapcodex', panel: 'relay', statusApi: 'https://api.cheapcodex.online/v1/models' };
const rlFetch = (res) => async (url) => (String(url) === RL_SITE.statusApi ? res : { status: 0, ok: false, error: 'unreachable' });

const rlKeyRequired = await probeSite(RL_SITE, rlFetch({ status: 401, ok: false, ms: 233, attempts: 1 }));
const rlOpen = await probeSite(RL_SITE, rlFetch({ status: 200, ok: true, ms: 180, attempts: 1 }));
const rl500 = await probeSite(RL_SITE, rlFetch({ status: 500, ok: false, ms: 90, attempts: 1 }));
const rlDown = await probeSite(RL_SITE, rlFetch({ status: 0, ok: false, ms: 20_000, error: 'timeout', attempts: 3 }));
const rlBlocked = await probeSite(RL_SITE, rlFetch({ status: 403, ok: false, ms: 140, attempts: 1 }));

test('401 是中转口的预期答案，算活着而不是算失败', () => {
  assert.equal(rlKeyRequired.apiOk, true);
  assert.equal(rlKeyRequired.error, null);
  assert.equal(rlKeyRequired.latencyMs, 233);
  assert.equal(rlOpen.apiOk, true);
});
test('relay 探到的东西只有「活着 + 延迟」，其余字段一律留空', () => {
  assert.equal(rlKeyRequired.systemName, null);
  assert.equal(rlKeyRequired.version, null);
  assert.equal(rlKeyRequired.registerOpen, null);
  assert.equal(rlKeyRequired.checkinEnabled, null);
  assert.equal(rlKeyRequired.inviteeBonusUsd, null);
  assert.deepEqual(rlKeyRequired.models, []);
  assert.equal(rlKeyRequired.modelsSource, 'login-required');
  assert.equal(rlKeyRequired.pricingOk, false);
});
test('500 / 超时如实报错，403 留给 merge 判「被 WAF 拦」而不是在这里吞掉', () => {
  assert.equal(rl500.apiOk, false);
  assert.equal(rl500.error, 'HTTP 500');
  assert.equal(rlDown.apiOk, false);
  assert.equal(rlDown.error, 'timeout');
  assert.equal(rlBlocked.apiOk, false);
  assert.equal(rlBlocked.error, 'HTTP 403');
  assert.equal(looksFiltered({ ok: false, status: 403 }), true);
});
test('relay 快照字段集合与 New API 面板完全一致（否则 merge 会漏字段）', () => {
  assert.deepEqual(Object.keys(rlKeyRequired).sort(), Object.keys(blankSnapshot(RL_SITE, {})).sort());
});
test('panel 注册表里有 relay，缺省仍是 newapi', () => {
  assert.equal(PANELS.relay.name, 'probeRelay');
});

console.log('tabitoken：按次计费的 New API 站（model_price，不是倍率）');
/**
 * 2026-08-30 从 tabitoken.com 实测抓到的返回体（status 只留探测会读的字段）。
 * 这个站是「按次计费」的典型：quota_type=1 + model_price，model_ratio 与 completion_ratio 全是 0，
 * 倍率照抄接口就等于在页面上写「免费」，所以这里把 fixedPrice 钉死。
 */
const TB_SITE = {
  id: 'tabitoken',
  name: 'TaBiAI',
  panel: 'newapi',
  statusApi: 'https://tabitoken.com/api/status',
  pricingApi: 'https://tabitoken.com/api/pricing',
  credits: { signup: 100, invite: 20, dailyCheckin: null, approx: false },
};
const TB_STATUS = {
  success: true,
  data: {
    system_name: 'TaBiAI',
    version: 'init-20260817-f880a343',
    register_enabled: true,
    password_register_enabled: false,
    password_login_enabled: true,
    github_oauth: true,
    linuxdo_oauth: false,
    discord_oauth: false,
    telegram_oauth: false,
    wechat_login: false,
    oidc_enabled: false,
    passkey_login: false,
    checkin_enabled: true,
    quota_per_unit: 500000,
    turnstile_check: true,
    price: 7.3,
    announcements: [],
  },
};
const tbModel = (name, price) => ({
  model_name: name,
  quota_type: 1,
  model_ratio: 0,
  model_price: price,
  completion_ratio: 0,
  enable_groups: ['vip', 'default'],
  supported_endpoint_types: ['anthropic', 'openai'],
});
const TB_PRICING = {
  success: true,
  data: [
    tbModel('claude-opus-5-thinking', 0.8),
    tbModel('claude-opus-5', 0.8),
    tbModel('claude-opus-4-8', 0.5),
    tbModel('claude-opus-4-8-thinking', 0.5),
  ],
};
const tb = await probeSite(
  TB_SITE,
  vcFetch({
    'https://tabitoken.com/api/status': { ok: true, status: 200, ms: 431, json: TB_STATUS },
    'https://tabitoken.com/api/pricing': { ok: true, status: 200, ms: 288, json: TB_PRICING },
  }),
);

test('站名 / 版本 / 签到开关 / 登录方式 都按接口原样取到', () => {
  assert.equal(tb.apiOk, true);
  assert.equal(tb.pricingOk, true);
  assert.equal(tb.systemName, 'TaBiAI');
  assert.equal(tb.version, 'init-20260817-f880a343');
  assert.equal(tb.registerOpen, true);
  assert.equal(tb.passwordRegister, false); // 只能 GitHub 授权注册
  assert.equal(tb.checkinEnabled, true);
  assert.deepEqual(tb.loginMethods, ['GitHub', '账号密码']);
  assert.equal(tb.quotaPerUnit, 500000);
  assert.equal(tb.latencyMs, 431);
});
test('接口没给 quota_for_invitee → 邀请额度留 null，不拿 sites.json 的 $20 冒充探测值', () => {
  assert.equal(tb.inviteeBonusUsd, null);
  assert.equal(tb.inviterBonusUsd, null);
  assert.equal(creditPlan(TB_SITE, tb).apiInvite, null);
  assert.deepEqual(auditCredits([TB_SITE], { sites: [tb] }), []); // 拿不到实测值就不该报「不一致」
});
test('注册 $100 + 本页邀请 $20 = 首日 $120，签到金额未公示所以不进合计', () => {
  const p = creditPlan(TB_SITE, tb);
  assert.equal(p.firstDay, 120);
  assert.equal(usd(p.firstDay, p.approx), '$120');
  assert.equal(breakdown(p), '注册 $100 + 本页邀请 $20');
  assert.equal(p.daily, null);
  assert.equal(perDay(p), null);
});
test('4 个模型都是按次计价：fixedPrice 有值，per-1M 单价一律 null', () => {
  assert.equal(tb.models.length, 4);
  const byName = new Map(tb.models.map((m) => [m.name, m]));
  assert.deepEqual([...byName.keys()], ['claude-opus-4-8', 'claude-opus-4-8-thinking', 'claude-opus-5', 'claude-opus-5-thinking']);
  for (const [name, price] of [
    ['claude-opus-5', 0.8],
    ['claude-opus-5-thinking', 0.8],
    ['claude-opus-4-8', 0.5],
    ['claude-opus-4-8-thinking', 0.5],
  ]) {
    const m = byName.get(name);
    assert.equal(m.fixedPrice, price, name);
    assert.equal(m.inputPerMTok, null, name); // ratio 0 换算出的 $0 是假的，必须留空
    assert.equal(m.outputPerMTok, null, name);
    assert.equal(m.ratio, 0, name);
    assert.deepEqual(m.protocols, ['anthropic', 'openai'], name);
    assert.deepEqual(m.groups, ['vip', 'default'], name);
  }
});
test('示例配置的默认模型取版本最新的 opus-5，两个协议都不许退回字母序第一个', () => {
  assert.equal(tb.defaults.claude, 'claude-opus-5');
  // 全站只有 claude-*，OpenAI 协议没有 gpt 系可挑；兜底若用 models[0] 会得到 claude-opus-4-8
  assert.equal(tb.defaults.openai, 'claude-opus-5');
});
test('tabitoken 快照字段集合与面板骨架完全一致', () => {
  assert.deepEqual(Object.keys(tb).sort(), Object.keys(blankSnapshot(TB_SITE, {})).sort());
});

// 只有 /api/pricing 吃了 403（机房 IP 的常见样子），status 照常通
const tbPricingBlocked = await probeSite(
  TB_SITE,
  vcFetch({
    'https://tabitoken.com/api/status': { ok: true, status: 200, ms: 402, json: TB_STATUS },
    'https://tabitoken.com/api/pricing': { ok: false, status: 403, ms: 190, error: 'HTTP 403' },
  }),
);
const TB_OLD = { ...tb, checkedAt: iso(6 * HOUR), online: true, signup: { status: 200, ok: true, ms: 240 } };
const tbMerged = mergeSnapshot({ ...tbPricingBlocked, signup: { status: 200, ok: true, ms: 260 } }, TB_OLD);

test('pricing 被拦时，按次价格沿用旧快照而不是变成空表', () => {
  assert.equal(tbMerged.models.length, 4);
  assert.equal(tbMerged.models[0].name, 'claude-opus-4-8');
  assert.equal(tbMerged.models[0].fixedPrice, 0.5);
  assert.equal(tbMerged.modelsSource, 'cached');
  assert.equal(tbMerged.online, true);
  assert.equal(tbMerged.dataStale, true);
  assert.equal(tbMerged.staleFrom, TB_OLD.checkedAt);
});
test('合并后重算默认模型，仍然是 opus-5（merge 的兜底也不许退回字母序）', () => {
  assert.equal(tbMerged.defaults.claude, 'claude-opus-5');
  assert.equal(tbMerged.defaults.openai, 'claude-opus-5');
});

console.log('工具函数');
test('meaningful 认得空值', () => {
  for (const v of [null, undefined, '', '   ', [], {}, { a: null }]) assert.equal(meaningful(v), false, JSON.stringify(v));
  for (const v of [0, false, 'x', [1], { a: 1 }]) assert.equal(meaningful(v), true, JSON.stringify(v));
});
test('pickPreferred 按数字段比大小，不是字典序', () => {
  const ms = [{ name: 'claude-opus-4-8' }, { name: 'claude-opus-5' }, { name: 'claude-sonnet-4-5' }];
  assert.equal(pickPreferred(ms, /^claude/i), 'claude-opus-5');
  assert.equal(pickPreferred([], /^claude/i), null);
});

console.log('注册页探测（online 有一半靠它，不能被网络抖动带偏）');
// 前两次连接层面失败、第三次才通：本机与 CI 都见过，注册页不该因此判成 HTTP 0
let flakyCalls = 0;
const flakyProbe = await probeUrl('https://example.test/sign-up', {
  backoffMs: 0,
  fetchImpl: async () => {
    flakyCalls += 1;
    if (flakyCalls < 3) throw new Error('connect EADDRNOTAVAIL 198.18.0.5:443');
    return { status: 200, ok: true };
  },
});
// 服务器答话了就是答话了：403 是 looksFiltered 判「被拦而非下线」的依据，不许被重试抹掉
let blockedCalls = 0;
const blockedProbe = await probeUrl('https://example.test/sign-up', {
  backoffMs: 0,
  fetchImpl: async () => {
    blockedCalls += 1;
    return { status: 403, ok: false };
  },
});
let deadCalls = 0;
const deadProbe = await probeUrl('https://example.test/sign-up', {
  backoffMs: 0,
  fetchImpl: async () => {
    deadCalls += 1;
    throw new Error('getaddrinfo ENOTFOUND example.test');
  },
});
const emptyProbe = await probeUrl(null);
// undici 的真实形状：外层只有一句 fetch failed，病因在 cause 里（2026-09-25 起 DoCode 新注册链接就是这样）
const certProbe = await probeUrl('https://example.test/register', {
  backoffMs: 0,
  fetchImpl: async () => {
    const cause = Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    throw new TypeError('fetch failed', { cause });
  },
});
const HEALTH_YML = await readFile(new URL('../.github/workflows/health.yml', import.meta.url), 'utf8');

test('连接抖动会重试，第三次通了就算通', () => {
  assert.equal(flakyProbe.status, 200);
  assert.equal(flakyProbe.ok, true);
  assert.equal(flakyProbe.attempts, 3);
  assert.equal(flakyCalls, 3);
});
test('HTTP 403 原样返回且不重试，WAF 判定才不会被抹掉', () => {
  assert.equal(blockedProbe.status, 403);
  assert.equal(blockedProbe.ok, false);
  assert.equal(blockedCalls, 1);
  assert.equal(looksFiltered(blockedProbe), true);
});
test('真连不上才报 HTTP 0，且把重试次数用完', () => {
  assert.equal(deadProbe.status, 0);
  assert.equal(deadProbe.ok, false);
  assert.match(deadProbe.error, /ENOTFOUND/);
  assert.equal(deadCalls, 3);
});
test('没有 URL 就不探测', () => {
  // test() 是同步的，异步断言得在外面 await 好再进来
  assert.equal(emptyProbe, null);
});
test('「fetch failed」要带上 err.cause 里的病因：证书对不上和站点挂了得分得清', () => {
  assert.equal(certProbe.status, 0);
  assert.equal(certProbe.error, 'fetch failed (ERR_TLS_CERT_ALTNAME_INVALID)');
  assert.equal(describeFetchError(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(describeFetchError(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout');
  assert.equal(describeFetchError(new Error('getaddrinfo ENOTFOUND a.test')), 'getaddrinfo ENOTFOUND a.test');
});
test('巡检的 `npm run check | tee` 必须带 pipefail，否则失败退出码被 tee 吞掉、永远不报警', () => {
  const step = HEALTH_YML.split(/\n\s*- name: /).find((s) => s.includes('npm run check'));
  assert.ok(step, 'health.yml 里找不到跑 npm run check 的那一步');
  assert.match(step, /set -o pipefail[\s\S]*npm run check[^\n]*\| tee/);
});

// ──────────────────────────────────────────────────────────────────────
// 变动日志 / 历史 / 多页渲染
// ──────────────────────────────────────────────────────────────────────

/** 一份最小可用的快照，只带 diff 会看的字段 */
const snap = (over = {}) => ({
  id: 'agentrouter',
  online: true,
  probeBlocked: false,
  registerOpen: true,
  checkinEnabled: true,
  inviteeBonusUsd: 50,
  inviterBonusUsd: 50,
  models: [{ name: 'claude-opus-5', ratio: 1, inputPerMTok: 2, outputPerMTok: 10, protocols: ['Anthropic'] }],
  announcements: [],
  latencyMs: 300,
  checkedAt: iso(0),
  ...over,
});
const SITES_FIXTURE = [{ id: 'agentrouter', name: 'AgentRouter', credits: { signup: 100, invite: 50, dailyCheckin: 25 } }];
const D = (prev, next) => diffSite({ prev, next, site: SITES_FIXTURE[0], at: iso(0) });
const types = (events) => events.map((e) => e.type);

console.log('diff：只报会影响「值不值得注册」的变动');

test('每 6 小时都在动的字段不产生事件（延迟 / 探测时间 / 版本）', () => {
  assert.deepEqual(types(D(snap(), snap({ latencyMs: 999, checkedAt: iso(0), version: 'x' }))), []);
});
test('本次探测被 WAF 拦下时不报掉线：online 是沿用值，不是观测值', () => {
  assert.deepEqual(types(D(snap({ online: true }), snap({ online: false, probeBlocked: true }))), []);
});
test('上次被拦、这次探通了 → 如实报掉线，否则日志里会只有恢复没有掉线', () => {
  const prev = snap({ online: true, probeBlocked: true });
  const next = snap({ online: false, probeBlocked: false });
  assert.deepEqual(types(D(prev, next)), ['offline']);
});
test('掉线与恢复成对出现', () => {
  assert.deepEqual(types(D(snap({ online: false }), snap({ online: true }))), ['online']);
});
test('邀请注册额度变化算 major，邀请他人的奖励只算 minor', () => {
  const e1 = D(snap(), snap({ inviteeBonusUsd: 20 }));
  const e2 = D(snap(), snap({ inviterBonusUsd: 20 }));
  assert.equal(e1[0].type, 'invite_change');
  assert.equal(e1[0].severity, 'major');
  assert.equal(e2[0].type, 'inviter_change');
  assert.equal(e2[0].severity, 'minor');
});
test('接口没给邀请额度（null）不报「$50 → $null」这种假变动', () => {
  assert.deepEqual(types(D(snap(), snap({ inviteeBonusUsd: null }))), []);
});

test('模型上下线与价格变化都要认，按次计费的价格用「/ 次」口径', () => {
  const added = D(snap(), snap({ models: [...snap().models, { name: 'glm-5.3', ratio: 1 }] }));
  const gone = D(snap(), snap({ models: [] }));
  const priced = D(snap(), snap({ models: [{ name: 'claude-opus-5', inputPerMTok: 8, outputPerMTok: 40 }] }));
  assert.deepEqual(types(added), ['models_added']);
  assert.deepEqual(types(gone), ['models_removed']);
  assert.deepEqual(types(priced), ['price_change']);
  assert.match(priced[0].text, /\$2 入 \/ \$10 出（每 1M） → \$8 入 \/ \$40 出（每 1M）/);
  assert.equal(priceLabel({ fixedPrice: 0.3 }), '$0.3 / 次');
});
test('模型一次上十几个时标题不爆：超过 4 个折成「等 N 个」', () => {
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name, ratio: 1 }));
  const e = D(snap({ models: [] }), snap({ models: many }));
  assert.match(e[0].text, /等 6 个/);
});
test('老公告不重复报，新公告截断到 140 字', () => {
  const old = { id: 1, text: '旧公告' };
  const long = { id: 2, text: '啊'.repeat(300) };
  assert.deepEqual(types(D(snap({ announcements: [old] }), snap({ announcements: [old] }))), []);
  const e = D(snap({ announcements: [old] }), snap({ announcements: [old, long] }));
  assert.deepEqual(types(e), ['announcement']);
  assert.ok(e[0].text.length <= 140 + 'AgentRouter 发了公告：'.length);
});
test('新站按 sites.json 的额度口径记一条收录事件，移除站点也记一条', () => {
  const added = diffSnapshots({ sites: [] }, { generatedAt: iso(0), sites: [snap()] }, SITES_FIXTURE);
  assert.deepEqual(types(added), ['site_added']);
  assert.equal(added[0].text, '新收录 AgentRouter：注册送 $100，邀请再加 $50，每日签到 $25');
  const removed = diffSnapshots({ sites: [snap()] }, { generatedAt: iso(0), sites: [] }, SITES_FIXTURE);
  assert.deepEqual(types(removed), ['site_removed']);
});
test('majorOnly 只放行值得发 Release 的类型', () => {
  const mixed = [...D(snap(), snap({ inviterBonusUsd: 20 })), ...D(snap(), snap({ inviteeBonusUsd: 20 }))];
  assert.deepEqual(types(majorOnly(mixed)), ['invite_change']);
});

console.log('history：可用性时间序列');

const DAY = 24 * HOUR;
const liveAt = (msAgo, over = {}) => ({
  generatedAt: iso(msAgo),
  sites: [{ id: 'agentrouter', online: true, probeBlocked: false, models: [{ name: 'm' }], latencyMs: 300, ...over }],
});
/** 6 小时一个点，攒 n 个 */
const seed = (n, over = () => ({})) => {
  let h = EMPTY_HISTORY;
  for (let i = n - 1; i >= 0; i -= 1) h = appendSample(h, liveAt(i * 6 * HOUR, over(i))).history;
  return h;
};

test('样本只留判断可用性必需的字段，被拦要如实标注', () => {
  const s = compact(liveAt(0, { online: true, probeBlocked: true }));
  assert.deepEqual(Object.keys(s.sites.agentrouter).sort(), ['blocked', 'latency', 'models', 'up']);
  assert.equal(s.sites.agentrouter.blocked, true);
});
test('同一个 generatedAt 只留一条：CI 重跑不该在历史里留重复点', () => {
  // 时间戳只取一次：liveAt(0) 调两次会差 1ms，那测的就不是「同一个 generatedAt」了，
  // 恰好跨过毫秒边界时这条会随机挂（实测约 5% 的运行），CI 的自动刷新会跟着变红
  const sample = liveAt(0);
  const one = appendSample(EMPTY_HISTORY, sample);
  const again = appendSample(one.history, sample);
  assert.equal(one.added, true);
  assert.equal(again.added, false);
  assert.equal(again.history.samples.length, 1);
});
test('样本按时间升序存，且按上限截断', () => {
  const h = seed(5);
  const ats = h.samples.map((s) => s.at);
  assert.deepEqual(ats, [...ats].sort());
  assert.equal(appendSample(seed(3), liveAt(0), { limit: 2 }).history.samples.length, 2);
});
test('样本不足一天（< 4 个点）时不给可用性百分比，页面据此说「样本还不够」', () => {
  assert.equal(uptime(seed(3), 'agentrouter', 7).enough, false);
  assert.equal(uptime(seed(8), 'agentrouter', 7).enough, true);
  assert.equal(uptime(seed(8), 'agentrouter', 7).percent, 100);
});
test('被拦的样本单独计数，不从在线数里扣', () => {
  const h = seed(8, (i) => (i < 2 ? { probeBlocked: true } : {}));
  const u = uptime(h, 'agentrouter', 7);
  assert.equal(u.blocked, 2);
  assert.equal(u.up, 8);
});
test('没有样本的那天 total = 0，状态页画成空档而不是掉线', () => {
  const days = byDay(appendSample(EMPTY_HISTORY, liveAt(3 * DAY)).history, 'agentrouter', 7);
  assert.equal(days.length, 7);
  assert.equal(days.filter((d) => d.total === 0).length, 6);
  assert.equal(days.filter((d) => d.total > 0)[0].ratio, 1);
});
test('没这个站的历史时不报错，返回空口径', () => {
  const u = uptime(seed(8), 'not-exists', 7);
  assert.deepEqual([u.total, u.ratio, u.percent, u.enough], [0, null, null, false]);
  assert.deepEqual(coverage(EMPTY_HISTORY), { samples: 0, from: null, to: null, days: 0 });
});

console.log('ciBaseline：变动日志只认 CI 的观测，本地提交的快照造不出假消息');

// 2026-09-30 的真实经过：本地探测 t.me 失败，Conduit 以 online=false 进了 HEAD 的 live.json，
// 而 CI 的历史样本里还没有它
const CONDUIT = { id: 'conduit', name: 'Conduit', credits: { signup: 500, invite: null, dailyCheckin: null } };
const BASE_SITES = [SITES_FIXTURE[0], CONDUIT];
const CI_HISTORY = appendSample(EMPTY_HISTORY, { generatedAt: iso(6 * HOUR), sites: [snap()] }).history;
const LOCAL_HEAD = { generatedAt: iso(6 * HOUR), sites: [snap(), snap({ id: 'conduit', online: false })] };
const CI_NEXT = { generatedAt: iso(0), sites: [snap(), snap({ id: 'conduit' })] };

test('本地提交进 HEAD 的新站：照记「新收录」并发 Release，不报「恢复在线」', () => {
  assert.deepEqual(types(diffSnapshots(LOCAL_HEAD, CI_NEXT, BASE_SITES)), ['online'], '修复前：只有一条假的恢复在线');
  const events = diffSnapshots(ciBaseline(LOCAL_HEAD, CI_HISTORY), CI_NEXT, BASE_SITES);
  assert.deepEqual(types(events), ['site_added']);
  assert.equal(events[0].text, '新收录 Conduit：注册送 $500');
  assert.deepEqual(types(majorOnly(events)), ['site_added']);
});
test('本地网络探不到、CI 一直探得到的站（09-23 的 Matrix）：不报掉线也不报恢复', () => {
  const head = { generatedAt: iso(6 * HOUR), sites: [snap({ online: false })] };
  const next = { generatedAt: iso(0), sites: [snap()] };
  assert.deepEqual(types(diffSnapshots(head, next, SITES_FIXTURE)), ['online'], '修复前：假的恢复在线');
  assert.deepEqual(types(diffSnapshots(ciBaseline(head, CI_HISTORY), next, SITES_FIXTURE)), []);
});
test('CI 自己观测到的掉线与恢复照报：换了基线口径，真变化不能被吞', () => {
  const head = { generatedAt: iso(6 * HOUR), sites: [snap()] };
  const down = { generatedAt: iso(3 * HOUR), sites: [snap({ online: false })] };
  assert.deepEqual(types(diffSnapshots(ciBaseline(head, CI_HISTORY), down, SITES_FIXTURE)), ['offline']);
  // 上一个 CI 样本是掉线，这次探通了 → 报恢复，哪怕 HEAD 里本地快照写的是在线
  const downHistory = appendSample(CI_HISTORY, down).history;
  const next = { generatedAt: iso(0), sites: [snap()] };
  assert.deepEqual(types(diffSnapshots(ciBaseline(head, downHistory), next, SITES_FIXTURE)), ['online']);
});
test('内容字段与「移除收录」照旧和 HEAD 快照比，不受基线影响', () => {
  const head = { generatedAt: iso(6 * HOUR), sites: [snap()] };
  const invite = { generatedAt: iso(0), sites: [snap({ inviteeBonusUsd: 20 })] };
  assert.deepEqual(types(diffSnapshots(ciBaseline(head, CI_HISTORY), invite, SITES_FIXTURE)), ['invite_change']);
  const gone = { generatedAt: iso(0), sites: [] };
  assert.deepEqual(types(diffSnapshots(ciBaseline(head, CI_HISTORY), gone, SITES_FIXTURE)), ['site_removed']);
});
test('还没有任何历史样本（首次运行）时原样比，不把所有站都当成新站', () => {
  assert.equal(ciBaseline(LOCAL_HEAD, EMPTY_HISTORY), LOCAL_HEAD);
  assert.equal(ciBaseline(null, CI_HISTORY), null);
});

console.log('changelog / Atom：订阅出口');

const META = {
  title: 'AI Coding 福利站导航',
  tagline: '免费额度合集',
  keywords: ['claude code'],
  repoUrl: 'https://github.com/panxunying/ai-coding-welfare',
  pagesUrl: 'https://panxunying.github.io/ai-coding-welfare/',
};
const EVENTS = [
  { at: '2026-08-30T08:56:00.000Z', siteId: 'rawchat', type: 'online', severity: 'major', text: 'RawChat 恢复在线' },
  { at: '2026-08-30T10:21:00.000Z', siteId: 'gorouter', type: 'site_added', severity: 'major', text: '新收录 GoRouter' },
  { at: '2026-08-26T11:42:00.000Z', siteId: 'agentrouter', type: 'price_change', severity: 'major', text: '价格变了 <b>' },
];
const GROUPS = groupByDay(EVENTS);

test('按天分组：天倒序、天内也倒序', () => {
  assert.deepEqual(GROUPS.map((g) => g.date), ['2026-08-30', '2026-08-26']);
  assert.deepEqual(GROUPS[0].events.map((e) => e.siteId), ['gorouter', 'rawchat']);
  assert.equal(GROUPS[0].updated, '2026-08-30T10:21:00.000Z');
});
test('Atom 一天一条 entry，不是一条事件一条推送（6 小时一次会淹掉订阅者）', () => {
  const xml = renderAtom({ meta: META, groups: GROUPS, updated: EVENTS[1].at });
  assert.equal(xml.match(/<entry>/g).length, 2);
  assert.match(xml, /<title>2026-08-30 · 2 项变动<\/title>/);
  assert.match(xml, /<id>tag:panxunying\.github\.io,2026-08-30:changelog<\/id>/);
});
test('Atom 正文里的 HTML 必须转义，否则 feed 是坏的 XML', () => {
  const xml = renderAtom({ meta: META, groups: GROUPS, updated: EVENTS[1].at });
  assert.ok(!/<b>/.test(xml));
  assert.match(xml, /&lt;b&gt;/);
});
test('空日志也能生成合法 feed', () => {
  const xml = renderAtom({ meta: META, groups: [], updated: null });
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.ok(!/<entry>/.test(xml));
});
test('Release 标题一句话概括，多条时带「另有 N 项」', () => {
  assert.equal(summarize([EVENTS[1]]), '新收录 GoRouter');
  assert.match(summarize(EVENTS), /（另有 2 项变动）$/);
  assert.equal(summarize([]), '没有变动');
  assert.equal(icon('offline'), '🔴');
  assert.equal(icon('unknown_type'), '·');
});

console.log('落地页：按次 vs 按量折算、结构化数据、转义');

const SITE = {
  id: 'demo',
  name: 'Demo 站',
  subtitle: '注册送额度的示例站',
  signupUrl: 'https://demo.test/register?aff=abc',
  recommended: true,
  tags: ['GitHub 登录'],
  credits: { signup: 100, invite: 20 },
  endpoints: { anthropic: 'https://demo.test', openai: 'https://demo.test/v1' },
  highlights: ['额度大方'],
  caveats: ['规则随时变'],
};
const FIXED_SNAP = {
  id: 'demo',
  online: true,
  probeBlocked: false,
  checkedAt: iso(0),
  models: [
    { name: 'claude-opus-5', fixedPrice: 0.3, protocols: ['Anthropic'] },
    { name: 'claude-haiku', fixedPrice: 0.1, protocols: ['Anthropic'] },
  ],
  defaults: { claude: 'claude-opus-5', openai: 'gpt-5.6' },
};
const TOKEN_SNAP = {
  ...FIXED_SNAP,
  models: [{ name: 'claude-opus-5', ratio: 1, inputPerMTok: 2, outputPerMTok: 10, protocols: ['Anthropic'] }],
};
const LIVE = { generatedAt: iso(0), sites: [FIXED_SNAP] };
const HIST = seed(8);
/** 把页面里的所有 JSON-LD 抠出来解析：坏掉的结构化数据在浏览器里是静默失效的 */
const jsonLd = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('按次计费用站内单价折算，按量计费按 15k 入 / 2k 出折算，两者落到同一个单位', () => {
  const fixed = estimateTurns(SITE, FIXED_SNAP);
  const token = estimateTurns(SITE, TOKEN_SNAP);
  // 首日 $120：按次挑最便宜的 $0.1 → 1200 次；按量 (2×15000 + 10×2000)/1M = $0.05 → 2400 次
  assert.deepEqual([fixed.billing, fixed.per, fixed.turns], ['按次', 0.1, 1200]);
  assert.deepEqual([token.billing, token.per, token.turns], ['按量', 0.05, 2400]);
});
test('积分站没有公开换算，不参与折算（宁可留空也不编数字）', () => {
  assert.equal(estimateTurns({ ...SITE, credits: { invite: 600, unit: 'point' } }, TOKEN_SNAP), null);
  assert.equal(estimateTurns(SITE, { ...FIXED_SNAP, models: [] }), null);
});

test('每一页的 JSON-LD 都必须是合法 JSON，且带面包屑', () => {
  const pages = [
    renderSitePage({ meta: META, site: SITE, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] }),
    renderComparePage({ meta: META, sites: [SITE], live: LIVE, css: '' }),
    renderStatusPage({ meta: META, sites: [SITE], live: LIVE, css: '', history: HIST }),
    renderChangelogPage({ meta: META, groups: GROUPS, live: LIVE, css: '' }),
    renderHtml({ meta: META, sites: [SITE], live: LIVE, css: '', groups: GROUPS, history: HIST }),
  ];
  for (const html of pages) {
    const blobs = jsonLd(html);
    assert.ok(blobs.length, 'JSON-LD 缺失');
    assert.match(html, /<link rel="canonical"/);
    assert.match(html, /rel="alternate" type="application\/atom\+xml"/);
  }
  const types = jsonLd(pages[0])[0].map((x) => x['@type']);
  assert.deepEqual(types, ['BreadcrumbList', 'FAQPage']);
});
const OG_PNG = await readFile(new URL('../docs/assets/og.png', import.meta.url));
test('每一页都带分享卡片与 favicon：声明了 summary_large_image 就得真给图，图得是 1200×630', () => {
  const pages = [
    renderSitePage({ meta: META, site: SITE, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] }),
    renderComparePage({ meta: META, sites: [SITE], live: LIVE, css: '' }),
    renderStatusPage({ meta: META, sites: [SITE], live: LIVE, css: '', history: HIST }),
    renderChangelogPage({ meta: META, groups: GROUPS, live: LIVE, css: '' }),
    renderHtml({ meta: META, sites: [SITE], live: LIVE, css: '', groups: GROUPS, history: HIST }),
  ];
  const image = `${META.pagesUrl}assets/og.png`;
  for (const html of pages) {
    assert.ok(html.includes(`<meta property="og:image" content="${image}">`));
    assert.ok(html.includes(`<meta name="twitter:image" content="${image}">`));
    assert.match(html, /<meta property="og:locale" content="zh_CN">/);
    assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,%3Csvg/);
  }
  // PNG 头：8 字节签名 + IHDR，宽高是第 16–23 字节的两个大端 uint32
  assert.equal(OG_PNG.subarray(1, 4).toString('latin1'), 'PNG');
  assert.deepEqual([OG_PNG.readUInt32BE(16), OG_PNG.readUInt32BE(20)], [1200, 630]);
  assert.ok(OG_PNG.length < 300_000, '分享图太大，部分平台（WhatsApp 等）会不显示预览');
  for (const l of LANGUAGES) assert.match(l.og, /^[a-z]{2}_[A-Z]{2}$/, `${l.id} 的 og:locale 格式不对`);
});
test('数据里的 HTML / 引号不许原样进页面（sites.json 是手工维护的，迟早会有尖括号）', () => {
  const evil = { ...SITE, name: '<img src=x onerror=alert(1)>', subtitle: '带"引号"的副标题' };
  const html = renderSitePage({ meta: META, site: evil, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] });
  assert.ok(!/<img src=x/.test(html));
  assert.match(html, /&lt;img src=x/);
});
test('JSON-LD 里的 </script> 要被打断，否则脚本块提前闭合、整页结构化数据失效', () => {
  const evil = { ...SITE, subtitle: '收工 </script><script>alert(1)</script>' };
  const html = renderSitePage({ meta: META, site: evil, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] });
  const ld = html.slice(html.indexOf('application/ld+json'), html.indexOf('</script>', html.indexOf('application/ld+json')));
  assert.ok(!ld.includes('</script>'));
  assert.equal(jsonLd(html).length, 1);
});
test('站点详情页给得出可复制的两套配置，Anthropic 的 Base URL 不带 /v1', () => {
  const html = renderSitePage({ meta: META, site: SITE, snap: FIXED_SNAP, live: LIVE, css: '', history: HIST, siblings: [] });
  assert.match(html, /export ANTHROPIC_BASE_URL=https:\/\/demo\.test\n/);
  assert.match(html, /ANTHROPIC_MODEL=claude-opus-5/);
  // config.toml 是写在 HTML 里的，引号已经被转义成 &quot;，这里按渲染后的样子断言
  assert.match(html, /base_url = &quot;https:\/\/demo\.test\/v1&quot;/);
  assert.match(html, /wire_api = &quot;chat&quot;/);
  assert.equal(html.match(/<button class="copy"/g).length, 2);
});
test('状态页把「没样本」和「掉线」画成两种格子', () => {
  const sparse = appendSample(EMPTY_HISTORY, liveAt(2 * DAY, { id: 'demo' })).history;
  const html = renderStatusPage({ meta: META, sites: [SITE], live: LIVE, css: '', history: sparse });
  assert.match(html, /class="bar nodata"/);
});
test('首页把 6 个站点写进 ItemList，每项指向自己的详情页', () => {
  const html = renderHtml({ meta: META, sites: [SITE], live: LIVE, css: '', groups: GROUPS, history: HIST });
  const list = jsonLd(html)[0].find((x) => x['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 1);
  assert.equal(list.itemListElement[0].url, `${META.pagesUrl}sites/demo/`);
  assert.match(html, /href="sites\/demo\/"/);
});

console.log('停注：站点还在跑但不收新用户，页面不许继续吆喝额度');

const SHUT_SNAP = { ...FIXED_SNAP, registerOpen: false, passwordRegister: false, loginMethods: ['GitHub'] };
const OAUTH_SNAP = { ...FIXED_SNAP, registerOpen: true, passwordRegister: false, loginMethods: ['GitHub', '账号密码'] };
const OPEN_SNAP = { ...FIXED_SNAP, registerOpen: true, passwordRegister: true, loginMethods: ['GitHub', '账号密码'] };

test('总闸关了是「暂停注册」，只关邮箱注册是「仅 GitHub 注册」，两者不能混为一谈', () => {
  assert.equal(signupRoute(SHUT_SNAP).state, 'closed');
  assert.equal(signupRoute(OAUTH_SNAP).state, 'oauth');
  assert.equal(signupRoute(OAUTH_SNAP).short, '仅 GitHub 注册');
  assert.equal(signupRoute(OPEN_SNAP).state, 'open');
  // 账号密码不是 OAuth 通道，不能出现在「仅 X 注册」里
  assert.deepEqual(signupRoute(OAUTH_SNAP).oauth, ['GitHub']);
});
test('接口没给 register_enabled（旧版面板）就什么都不声称', () => {
  const r = signupRoute(FIXED_SNAP);
  assert.deepEqual([r.state, r.short, r.note], ['unknown', null, null]);
  assert.equal(acceptsNew(FIXED_SNAP), true, '拿不到字段不等于停注');
  assert.equal(acceptsNew(SHUT_SNAP), false);
});
test('停注的站点不算进「全注册能拿多少」，否则是虚报', () => {
  const shutLive = { generatedAt: iso(0), sites: [{ ...SHUT_SNAP, id: 'demo' }] };
  const openLive = { generatedAt: iso(0), sites: [{ ...OPEN_SNAP, id: 'demo' }] };
  const shutHtml = renderHtml({ meta: META, sites: [SITE], live: shutLive, css: '', groups: [], history: HIST });
  const openHtml = renderHtml({ meta: META, sites: [SITE], live: openLive, css: '', groups: [], history: HIST });
  assert.match(openHtml, /首日最高 <b>\$120<\/b>/);
  assert.doesNotMatch(shutHtml, /首日最高/, '唯一的站停注了，就不该再有「首日最高」这个数');
  assert.match(shutHtml, /可注册 <b>0\/1<\/b>/);
  // 卡片留在页面上（老用户还用得着），但额度划掉、主按钮降级
  assert.match(shutHtml, /class="card[^"]*shut"/);
  assert.match(shutHtml, /<b class="struck">\$120<\/b>/);
  assert.doesNotMatch(shutHtml, /免费注册 Demo 站/);
});
test('停注的站不参与「最耐用」排序，README 里额度划掉、状态写停注', () => {
  const shutLive = { generatedAt: iso(0), sites: [{ ...SHUT_SNAP, id: 'demo' }] };
  const cmp = renderComparePage({ meta: META, sites: [SITE], live: shutLive, css: '' });
  assert.doesNotMatch(cmp, /最耐用 <b>/, '唯一候选停注了就没有「最划算」的答案');
  assert.match(cmp, /<tr class="shut">/);
  const md = renderReadme({ meta: META, sites: [SITE], live: shutLive, groups: [], history: HIST });
  assert.match(md, /🟡 停注/);
  assert.match(md, /~~\$120~~/);
  assert.match(md, /已停注 · 仍可打开/);
  assert.doesNotMatch(md, /全注册一遍/, '没有还收人的站时不该给合计');
});
test('邀请码要手填的站才出「邀请码」列，且写清 — 不等于没有邀请额度', () => {
  const live = { generatedAt: iso(0), sites: [{ id: 'demo', online: true, registerOpen: true }] };
  const plain = renderReadme({ meta: META, sites: [SITE], live, groups: [], history: HIST });
  assert.doesNotMatch(plain, /\| 邀请码 \|/, '没有站需要手填时不该多出一个空列');

  const coded = { ...SITE, inviteCode: 'zMRe' };
  const md = renderReadme({ meta: META, sites: [coded], live, groups: [], history: HIST });
  assert.match(md, /\| 模型 \| 注册 \| 邀请码 \|/, '邀请码列排在最后');
  assert.match(md, /`zMRe` \|$/m);
  assert.match(md, /注册表单里有一栏要\*\*自己填\*\*/);
  // 表头、分隔行、数据行的列数必须一致，否则 GitHub 上整张表会散架
  const [head, sep, row] = md.split('\n').filter((l) => l.startsWith('| ')).slice(0, 3);
  const cols = (l) => l.split('|').length;
  assert.equal(cols(head), cols(sep));
  assert.equal(cols(head), cols(row));
});
test('投稿公告在首屏：README 的 [!TIP] 排在总表前，首页排在大标题上方，两边都给提交和逛 Issue 两个入口', () => {
  const live = { generatedAt: iso(0), sites: [{ id: 'demo', online: true, registerOpen: true }] };
  const md = renderReadme({ meta: META, sites: [SITE], live, groups: [], history: HIST });
  const tip = md.indexOf('> [!TIP]');
  assert.ok(tip > 0 && tip < md.indexOf('## 🚀 一分钟上车'), '公告要在首屏，排在总表之前');
  assert.ok(md.includes(`[提交 Issue](${META.repoUrl}/issues/new/choose)`), '提交入口走模板选择页，推广别的也能开空白 Issue');
  assert.ok(md.includes(`[逛逛 Issue 区](${META.repoUrl}/issues)`));
  assert.match(md, /特别优质、实测靠谱的，我会收录进正文/);
  assert.doesNotMatch(md, /我来收录/, '底部不能再承诺「投了就收录」，和顶部口径打架');
  assert.match(md, /Issue 区的投稿由网友自行发布，未经本仓库核实/);

  const html = renderHtml({ meta: META, sites: [SITE], live, css: '', groups: [], history: HIST });
  const hero = html.slice(html.indexOf('<header class="hero">'), html.indexOf('</header>'));
  assert.ok(hero.includes('<p class="announce">'), '首页 hero 里要有投稿公告');
  assert.ok(hero.indexOf('class="announce"') < hero.indexOf('<h1>'), '公告排在大标题上方');
  assert.ok(hero.includes(`href="${META.repoUrl}/issues/new/choose"`));
  assert.ok(hero.includes(`href="${META.repoUrl}/issues"`));
});
test('停注变动进日志时带上接口口径，别让人以为是我们猜的', () => {
  const [ev] = D({ ...snap(), registerOpen: true }, { ...snap(), registerOpen: false });
  assert.equal(ev.type, 'register_closed');
  assert.match(ev.text, /register_enabled=false/);
  assert.match(ev.text, /老用户不受影响/);
  assert.equal(ev.severity, 'major', '停注必须能触发 Release / 推送');
});

console.log('历史区与非数值权益：归档不能继续推荐，新站不虚报额度');
const ARCHIVED = {
  ...SITE, id: 'retired', name: '已停用示例', recommended: false,
  signupUrl: 'https://retired.test/register?aff=old',
  archived: { at: '2026-09-21', reason: '用户反馈不可用 <不可当 HTML>' },
  credits: { signup: 9000 },
};
const ARCHIVED_LIVE = {
  ...LIVE,
  sites: [...LIVE.sites, { ...FIXED_SNAP, id: ARCHIVED.id, models: [{ name: 'retired-only-model', fixedPrice: 0.1 }] }],
};
test('归档分组不改变源数组；活跃顺序保留，历史按日期倒序', () => {
  const later = { ...ARCHIVED, id: 'later', archived: { at: '2026-09-23' } };
  const input = [ARCHIVED, SITE, later];
  assert.deepEqual(activeSites(input).map((s) => s.id), ['demo']);
  assert.deepEqual(archivedSites(input).map((s) => s.id), ['later', 'retired']);
  assert.deepEqual(input.map((s) => s.id), ['retired', 'demo', 'later']);
  assert.equal(isArchived({ archived: false }), false);
  assert.equal(archivedAt(SITE), null);
  assert.equal(archivedReason(later), '站点已不可用');
  assert.deepEqual(activeSites(), []);
  assert.deepEqual(archivedSites(), []);
});
test('首页只在历史区展示归档站，不留卡片、注册入口、模型和额度', () => {
  const html = renderHtml({ meta: META, sites: [SITE, ARCHIVED], live: ARCHIVED_LIVE, css: '', groups: [], history: HIST });
  const main = html.slice(html.indexOf('<body>'), html.indexOf('<section id="graveyard">'));
  assert.ok(!main.includes(ARCHIVED.name));
  assert.ok(!html.includes(ARCHIVED.signupUrl));
  assert.ok(!html.includes('retired-only-model'));
  assert.ok(!html.includes('$9000'));
  assert.match(html, /历史区 · 已停用站点/);
  assert.match(html, /用户反馈不可用 &lt;不可当 HTML&gt;/);
  const items = jsonLd(html).flat().find((x) => x['@type'] === 'ItemList').itemListElement;
  assert.deepEqual(items.map((x) => x.name), [SITE.name]);
});
test('README 归档站只留历史条目，不进总表与美元合计', () => {
  const md = renderReadme({ meta: META, sites: [SITE, ARCHIVED], live: ARCHIVED_LIVE, groups: [], history: HIST });
  const main = md.slice(0, md.indexOf('## 📦 历史区'));
  assert.ok(!main.includes(ARCHIVED.name));
  assert.ok(!md.includes(ARCHIVED.signupUrl));
  assert.ok(!md.includes('$9000'));
  assert.match(md, /\*\*\$120\*\*/);
  assert.ok(md.includes(`[变动日志](${META.pagesUrl}changelog/)`));
});
test('横评与当前可用性也过滤归档站；旧快照不能把它加回来', () => {
  assert.equal(estimateTurns(ARCHIVED, FIXED_SNAP), null);
  for (const render of [renderComparePage, renderStatusPage]) {
    const html = render({ meta: META, sites: [SITE, ARCHIVED], live: ARCHIVED_LIVE, css: '', history: HIST });
    assert.ok(!html.includes(ARCHIVED.name));
    assert.ok(!html.includes('sites/retired/'));
  }
});
test('旧详情页改成 noindex 归档说明，不留过期注册和配置', () => {
  const html = renderSitePage({ meta: META, site: ARCHIVED, snap: FIXED_SNAP, live: ARCHIVED_LIVE, css: '', history: HIST });
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.match(html, /已归档/);
  assert.match(html, /href="\.\.\/\.\.\/#graveyard"/);
  assert.ok(!html.includes(ARCHIVED.signupUrl));
  assert.ok(!html.includes('ANTHROPIC_BASE_URL'));
  assert.ok(!html.includes('$9000'));
});
test('归档事件写清移入历史区，而不是把保留的记录说成已删除', () => {
  const [event] = diffSnapshots({ sites: [{ id: ARCHIVED.id }] }, { generatedAt: iso(0), sites: [] }, [ARCHIVED]);
  assert.equal(event.type, 'site_removed');
  assert.match(event.text, /移入历史区 已停用示例：用户反馈不可用/);
});
test('所有站点都归档时，首页和 README 仍可正常生成', () => {
  const args = { meta: META, sites: [ARCHIVED], live: ARCHIVED_LIVE, css: '', groups: [], history: HIST };
  assert.match(renderHtml(args), /历史区 · 已停用站点/);
  assert.match(renderReadme(args), /历史区 · 已停用站点/);
});
test('变动日志保留历史事件，但只给未归档站提供推荐详情入口', () => {
  const html = renderChangelogPage({ meta: META, groups: GROUPS, live: LIVE, css: '', siteIds: ['agentrouter'] });
  assert.match(html, /新收录 GoRouter/);
  assert.match(html, /sites\/agentrouter\//);
  assert.ok(!html.includes('href="../sites/gorouter/"'));
});
const CATALOG = JSON.parse(await readFile(new URL('../data/sites.json', import.meta.url), 'utf8')).sites;
const MIRASIM = CATALOG.find((s) => s.id === 'mirasim');
test('ArtBloom 下架归档，Codex Relay 排第一，其余站顺延，历史归档站保持归档', () => {
  assert.deepEqual(activeSites(CATALOG).slice(0, 7).map((site) => site.id), ['codex-relay', 'omnirush', 'conduit', 'agentrouter', 'docode', 'justdowork', 'mirasim']);
  for (const id of ['artbloom', 'gorouter', 'tabitoken', 'rawchat']) assert.equal(isArchived(CATALOG.find((s) => s.id === id)), true);
  assert.equal(new Set(CATALOG.map((s) => s.id)).size, CATALOG.length);
  assert.equal(MIRASIM.signupUrl, 'https://mirasim.ai/r/go-kx9cd5');
});
const DOCODE = CATALOG.find((s) => s.id === 'docode');
// ai.docode.life / ai.docode.pro 和 docode.cc 是同一台服务器，证书却只签了 docode.cc：
// 2026-09-25 把注册链接换成 ai.docode.life 后，访客点进去就是浏览器证书报错，死链巡检也从此天天 ✖
test('DoCode 注册链接走证书有效的主域名 docode.cc，展示与健康检查一致，邀请码不变', () => {
  assert.equal(DOCODE.signupUrl, 'https://docode.cc/register?aff=zMRe');
  assert.equal(new URL(DOCODE.signupUrl).host, new URL(DOCODE.homeUrl).host);
  assert.equal(signupProbeUrl(DOCODE), DOCODE.signupUrl);
  assert.equal(DOCODE.inviteCode, 'zMRe');
  assert.deepEqual(DOCODE.endpoints, { anthropic: 'https://docode.cc', openai: 'https://docode.cc/v1' });
});
const FLUSHAPI = CATALOG.find((s) => s.id === 'flushapi');
test('FlushAPI 顺延第八位，邀请链接与公开接口齐全', () => {
  assert.equal(activeSites(CATALOG)[7].id, 'flushapi');
  assert.equal(FLUSHAPI.signupUrl, 'https://flushapi.fun/sign-up?aff=WBF3');
  assert.equal(signupProbeUrl(FLUSHAPI), FLUSHAPI.signupUrl);
  assert.equal(FLUSHAPI.statusApi, 'https://flushapi.fun/api/status');
  assert.equal(FLUSHAPI.pricingApi, 'https://flushapi.fun/api/pricing');
});
test('FlushAPI 首日 $22.5 = 注册 $15 + 邀请 $7.5，公告口径计入跨站合计', () => {
  const plan = creditPlan(FLUSHAPI);
  assert.equal(plan.signup, 15);
  assert.equal(plan.invite, 7.5);
  assert.equal(plan.firstDay, 22.5);
  assert.equal(plan.daily, null, '签到数额公告与接口都没写，不编数字');
  assert.match(plan.note, /公告/);
  assert.deepEqual(usdTotals([plan]), { count: 1, best: 22.5, total: 22.5, resetting: false, others: [] });
  assert.deepEqual(auditCredits([FLUSHAPI], LIVE), []);
  const [event] = diffSnapshots({ sites: [] }, { generatedAt: iso(0), sites: [{ id: FLUSHAPI.id }] }, [FLUSHAPI]);
  assert.equal(event.type, 'site_added');
  assert.equal(event.text, `新收录 ${FLUSHAPI.name}：注册送 $15，邀请再加 $7.5`);
});
test('不抓 robots 禁止的邀请路径，展示链接仍保持原样', () => {
  assert.equal(signupProbeUrl(MIRASIM), 'https://mirasim.ai/pricing');
  assert.equal(signupProbeUrl(SITE), SITE.signupUrl);
  assert.equal(MIRASIM.statusApi, 'https://mirasim.ai/pricing');
  assert.equal(MIRASIM.panel, 'relay');
});
test('自带 Key 免费不是赠送 API 额度，不增加美元合计或站点数', () => {
  const plan = creditPlan(MIRASIM);
  assert.equal(plan.firstDay, null);
  assert.equal(plan.invite, null);
  assert.match(plan.note, /赠额未公示/);
  assert.deepEqual(usdTotals([creditPlan(SITE), plan]), usdTotals([creditPlan(SITE)]));
  assert.deepEqual(auditCredits([MIRASIM], LIVE), []);
  assert.equal(estimateTurns(MIRASIM, TOKEN_SNAP), null);
});
test('Mirasim 收录事件说明免费范围，不捏造美元额度', () => {
  const [event] = diffSnapshots({ sites: [] }, { generatedAt: iso(0), sites: [{ id: MIRASIM.id }] }, [MIRASIM]);
  assert.equal(event.text, `新收录 Mirasim：${MIRASIM.credits.note}`);
});
test('Mirasim 的免费范围与有条件赠月显示到页面，不套用注册即送的 FAQ', () => {
  const args = { meta: META, sites: [MIRASIM], live: LIVE, css: '', groups: [], history: HIST };
  for (const output of [renderHtml(args), renderReadme(args), renderComparePage(args)]) {
    assert.ok(output.includes(MIRASIM.credits.note));
  }
  const html = renderSitePage({ ...args, site: MIRASIM, history: HIST });
  assert.match(html, /模型与套餐说明/);
  assert.match(html, /三人都开通 Go 后/);
  assert.ok(!html.includes('退出登录再重新登录一次通常就到账'));
  assert.ok(!html.includes('ANTHROPIC_BASE_URL'));
  const faq = jsonLd(html).flat().find((x) => x['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, MIRASIM.faq.length);
});

console.log('Go 套餐价量展示：月费、窗口、模型用量同时可见');
test('订阅独立记录价格、5 小时窗口和三档估算，不拼成美元赠额', () => {
  const sub = subscriptionPlan(MIRASIM);
  assert.equal(sub.price, '$1/月');
  assert.equal(sub.listPrice, null);
  assert.equal(sub.label, 'Go套餐 $1/月');
  assert.equal(sub.window, '每 5 小时');
  assert.deepEqual(sub.estimates.map((e) => [e.model, e.amount]), [
    ['Kimi K3', '≈130 次'], ['GLM 5.3 Flash', '≈1,900 次'], ['DS 4.1 Flash', '≈7,800 次'],
  ]);
  assert.equal(subscriptionPlan(SITE), null);
  assert.equal(renderSubscription(SITE), '');
  assert.equal(creditPlan(MIRASIM).firstDay, null);
  assert.equal(usdTotals([creditPlan(MIRASIM)]).count, 0);
});
test('README 总表直接呈现 $1 月费与三档用量，不再把卖点藏进详情', () => {
  const md = renderReadme({ meta: META, sites: CATALOG, live: LIVE, groups: [], history: HIST });
  const table = md.split('\n').filter((l) => l.startsWith('| '));
  const row = table.find((l) => l.startsWith('| **Mirasim**'));
  assert.match(table[0], /首日可得 \/ 套餐/);
  assert.equal(row.split('|')[3].trim(), '**Go套餐 $1/月**');
  assert.ok(!md.includes('标价 $18'));
  for (const label of ['Kimi K3', '≈130 次', 'GLM 5.3 Flash', '≈1,900 次', 'DS 4.1 Flash', '≈7,800 次', '每 5 小时', '共享额度']) assert.ok(row.includes(label), label);
  assert.ok(!row.includes('需登录查看'));
  assert.ok(!row.includes('自带 Key 免费'));
  assert.ok(row.includes('[查看 Go →](https://mirasim.ai/r/go-kx9cd5)'));
  assert.equal(row.split('|').length, table[0].split('|').length);
  const intro = md.slice(0, md.indexOf('## 📚 站点详情'));
  assert.match(intro, /各模型次数不可相加/);
  assert.match(intro, /付费套餐不计入下方免费额度合计/);
  assert.match(intro, /\*\*\$1109\.5\*\*/);
});
test('卡片和详情页使用同一价量区块，免费范围是补充信息', () => {
  const args = { meta: META, sites: [MIRASIM], live: LIVE, css: '', groups: [], history: HIST };
  for (const html of [renderHtml(args), renderSitePage({ ...args, site: MIRASIM })]) {
    assert.ok(html.includes(renderSubscription(MIRASIM)));
    assert.match(html, /Go套餐 \$1\/月/);
    assert.ok(!html.includes('标价 $18'));
    assert.match(html, /≈7,800 次/);
    assert.match(html, /各模型次数不可相加/);
    assert.ok(html.indexOf('class="subscription"') < html.indexOf('<dt>免费范围</dt>'));
    assert.ok(!html.includes('免费注册 Mirasim'));
  }
});
test('横评展示付费月费和窗口用量，不把官方请求量当成免费 Claude 往返次数', () => {
  const html = renderComparePage({ meta: META, sites: [MIRASIM], live: LIVE, css: '' });
  assert.match(html, /Go 月订阅（付费）/);
  assert.match(html, /Go套餐 \$1\/月/);
  assert.ok(!html.includes('标价 $18'));
  assert.match(html, /\$1\/月/);
  assert.match(html, /每 5 小时/);
  assert.match(html, /≈7,800 次/);
  assert.match(html, /各模型次数不可相加/);
  assert.equal(estimateTurns(MIRASIM, TOKEN_SNAP), null);
});
test('订阅区块转义模型名与来源属性，没有标价时不捏造原价', () => {
  const site = { ...MIRASIM, subscription: { ...MIRASIM.subscription, name: '<Go>', listMonthlyUsd: null, sourceUrl: 'https://example.test/?a="b"', estimates: [{ model: '<img src=x>', requests: 130 }] } };
  const html = renderSubscription(site);
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /&quot;b&quot;/);
  assert.ok(!html.includes('官网标价'));
});

console.log('安全：出网协议与 Telegram 转义（issue #3 的安全报告）');
let blockedFetchCalls = 0;
const httpJson = await fetchJson('http://example.test/api/status');
const fileProbe = await probeUrl('file:///etc/passwd', {
  fetchImpl: async () => {
    blockedFetchCalls += 1;
    return { status: 200, ok: true };
  },
});

test('sites.json 里的 URL 只允许 https，file: / http: / 垃圾串一律不出网', () => {
  assert.equal(isHttpsUrl('https://example.test/a'), true);
  assert.equal(isHttpsUrl('http://example.test/a'), false);
  assert.equal(isHttpsUrl('file:///etc/passwd'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('//example.test/a'), false);
  assert.equal(isHttpsUrl(''), false);
  assert.equal(isHttpsUrl(null), false);
});
test('非 https 在 fetchJson / probeUrl 里就被挡下，根本不发请求', () => {
  assert.equal(httpJson.ok, false);
  assert.match(httpJson.error, /https/);
  assert.equal(fileProbe.ok, false);
  assert.equal(blockedFetchCalls, 0, '被挡住的 URL 不该真的发出去');
});
test('Telegram 正文把双引号也转义掉，别让人从 href="…" 里逃出去', () => {
  const t = telegramText({
    meta: { title: 'T', pagesUrl: 'https://ok.test/', repoUrl: 'https://ok.test/r" onmouseover="x' },
    events: [],
  });
  assert.match(t, /&quot; onmouseover=&quot;x/, '引号必须变成实体');
  assert.ok(!t.includes('" onmouseover="'), '属性值里不许留活引号');
  assert.equal((t.match(/<a href="/g) ?? []).length, 2, '还是两个链接，没被撑出第三个属性');
});
test('Telegram 正文里的 < > & 照常转义，且不多转 &apos;（Telegram 不认这个实体）', () => {
  const t = telegramText({
    meta: { title: 'A & B', pagesUrl: 'https://ok.test/', repoUrl: 'https://ok.test/r' },
    events: [{ type: 'site_added', text: `<b>x</b> & it's` }],
    icon: () => '🆕',
  });
  assert.match(t, /A &amp; B/);
  assert.match(t, /&lt;b&gt;x&lt;\/b&gt; &amp; it's/);
  assert.ok(!t.includes('&apos;'));
});
test('超过 12 条折成「另有 N 项」，6 小时一次不该把频道刷满', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ type: 'online', text: `e${i}` }));
  const t = telegramText({
    meta: { title: 'T', pagesUrl: 'https://ok.test/', repoUrl: 'https://ok.test/r' },
    events: many,
    icon: () => '🟢',
  });
  assert.match(t, /另有 3 项/);
  assert.equal((t.match(/^🟢 e\d+$/gm) ?? []).length, 12);
});

console.log('多语言：共享数据、完整翻译、等价页面链接与归档安全');
const TRANSLATIONS = await Promise.all(TRANSLATED_LANGUAGES.map(async (l) =>
  JSON.parse(await readFile(new URL(`../data/locales/${l.id}.json`, import.meta.url), 'utf8')),
));
const ENGLISH = TRANSLATIONS.find((c) => c.locale === 'en');
const I18N_LIVE = { generatedAt: '2026-09-24T04:00:00Z', sites: activeSites(CATALOG).map((s) => ({
  id: s.id, online: true, registerOpen: true, checkinEnabled: true, checkedAt: '2026-09-24T04:00:00Z',
})) };

test('保留中文并新增五种语种，不把国别推断当成官方语种榜', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.id), ['zh-CN', 'en', 'hi', 'pt-BR', 'ja', 'de']);
  assert.match(ENGLISH.ui.selectionNote, /does not publish an official ranking/);
  assert.match(ENGLISH.ui.selectionNote, /India is multilingual/);
  assert.throws(() => language('xx'), /Unsupported locale/);
});
test('缺翻译、少占位符和新增站没翻译时失败，不静默回退', () => {
  const missing = structuredClone(ENGLISH);
  delete missing.ui.closed;
  assert.throws(() => validateCatalog(missing, ENGLISH, CATALOG), /missing\/extra keys/);
  const variable = structuredClone(ENGLISH);
  variable.ui.total = 'Total';
  assert.throws(() => validateCatalog(variable, ENGLISH, CATALOG), /invalid translation ui.total/);
  assert.throws(() => validateCatalog(ENGLISH, ENGLISH, [{ id: 'untranslated' }]), /missing site translation/);
  assert.throws(() => interpolate('{missing}'), /Missing translation variable/);
});
test('语言切换是原生链接，当前语言及目标页明确', () => {
  const nav = languageNav({ locale: 'de', base: '../../../', path: 'sites/flushapi/' });
  assert.equal((nav.match(/<a /g) ?? []).length, 6);
  assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
  for (const l of LANGUAGES) assert.ok(nav.includes(`href="../../../${l.path}sites/flushapi/"`));
});

for (const catalog of TRANSLATIONS) {
  const locale = language(catalog.locale);
  const args = { meta: META, sites: CATALOG, live: I18N_LIVE, css: '', catalog };
  const homepage = renderLocalizedHome(args);
  const readme = renderLocalizedReadme(args);
  test(`${locale.id}：翻译完整，语言元数据和首页 canonical 独立`, () => {
    validateCatalog(catalog, ENGLISH, CATALOG);
    assert.ok(homepage.includes(`<html lang="${locale.id}">`));
    assert.ok(homepage.includes(`<meta property="og:locale" content="${locale.og}">`));
    assert.ok(homepage.includes(`<meta property="og:image" content="${META.pagesUrl}assets/og.png">`));
    assert.ok(homepage.includes(`rel="canonical" href="${META.pagesUrl}${locale.path}"`));
    assert.equal((homepage.match(/<link rel="alternate" hreflang=/g) ?? []).length, 7);
    assert.ok(!/\{(?:providers|count|amount|inviteCode|hours|at)\}/.test(readme + homepage));
    assert.ok(readme.includes('README.md') && readme.includes('> [!TIP]'));
    assert.ok(homepage.indexOf(catalog.ui.submitTitle) < homepage.indexOf(`<h1>`));
    assert.ok(homepage.includes('/issues/new/choose') && homepage.includes(`${META.repoUrl}/issues"`));
  });
  test(`${locale.id}：顺序、邀请链接和免费额度总计共用源数据`, () => {
    const ld = JSON.parse(homepage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld.itemListElement[0].name, 'Codex Relay');
    assert.equal(ld.itemListElement[1].name, 'OmniRush');
    assert.equal(ld.itemListElement[2].name, 'Conduit');
    assert.equal(ld.itemListElement[7].name, 'FlushAPI');
    assert.equal(ld.numberOfItems, activeSites(CATALOG).length);
    assert.ok(readme.includes('$1109.5') && homepage.includes('$1109.5'));
    for (const s of activeSites(CATALOG)) {
      assert.ok(readme.includes(s.signupUrl));
      assert.ok(homepage.includes(`href="${s.signupUrl.replace(/&/g, '&amp;')}"`));
    }
    assert.ok(!readme.includes('$600') && !readme.includes('$300'));
    assert.ok(readme.includes(catalog.ui.points) && readme.includes(catalog.ui.siteUnits));
  });
  test(`${locale.id}：停注划掉额度并移出合计，OAuth-only 不误判`, () => {
    const live = structuredClone(I18N_LIVE);
    live.sites.find((s) => s.id === 'agentrouter').registerOpen = false;
    const html = renderLocalizedHome({ ...args, live });
    assert.ok(html.includes('$934.5') && !html.includes('$1109.5'));
    assert.ok(html.includes('<b class="struck">$175</b>'));
    const md = renderLocalizedReadme({ ...args, live });
    assert.ok(md.includes('~~$175~~'));
    const oauth = renderLocalizedSite({ ...args, site: FLUSHAPI, snap: {
      online: true, registerOpen: true, passwordRegister: false, loginMethods: ['GitHub'], checkinEnabled: true,
    } });
    assert.ok(oauth.includes(interpolate(catalog.ui.oauth, { providers: 'GitHub' })));
    assert.ok(oauth.includes(catalog.ui.checkinUnknown) && !oauth.includes('class="struck"'));
  });
  test(`${locale.id}：订阅窗口与模型数量动态生成，变化不用改五份译文`, () => {
    const edited = structuredClone(MIRASIM);
    edited.subscription.monthlyUsd = 2;
    edited.subscription.windowHours = 7;
    edited.subscription.estimates[0].requests = 131;
    const html = renderLocalizedSite({ ...args, site: edited });
    assert.ok(html.includes(interpolate(catalog.ui.perMonth, { amount: '$2' })));
    assert.ok(html.includes(interpolate(catalog.ui.window, { hours: 7 })));
    assert.ok(html.includes(interpolate(catalog.ui.requests, { count: '131' })));
    assert.ok(html.includes(catalog.ui.planNote));
    const changed = { ...FLUSHAPI, credits: { ...FLUSHAPI.credits, signup: 16 } };
    assert.ok(renderLocalizedSite({ ...args, site: changed }).includes('$23.5'));
  });
  test(`${locale.id}：旧语言详情覆盖为 noindex，不保留归档站邀请和配置`, () => {
    const archived = { ...FLUSHAPI, archived: { at: '2026-09-24', reason: 'test' } };
    const html = renderLocalizedSite({ ...args, site: archived });
    assert.match(html, /name="robots" content="noindex,follow"/);
    assert.ok(!html.includes(archived.signupUrl));
    assert.ok(!html.includes('$22.5'));
    assert.ok(!html.includes('https://flushapi.fun/v1'));
    const archivedAll = CATALOG.map((s) => ({ ...s, archived: { at: '2026-09-24', reason: 'test' } }));
    assert.doesNotThrow(() => renderLocalizedHome({ ...args, sites: archivedAll }));
  });
  test(`${locale.id}：快照过时与 WAF 明示，按次单价不冒充 token 单价`, () => {
    const snap = { ...I18N_LIVE.sites[0], dataStale: true, probeBlocked: true, staleFrom: '2026-09-20T00:00:00Z',
      models: [{ name: 'test-model', fixedPrice: 0.8, inputPerMTok: 999, outputPerMTok: 999, protocols: ['Anthropic'] }] };
    const html = renderLocalizedSite({ ...args, site: FLUSHAPI, snap });
    assert.ok(html.includes(catalog.ui.blocked));
    assert.ok(html.includes('2026-09-20 00:00 UTC'));
    assert.ok(html.includes('$0.8') && !html.includes('$999'));
    assert.ok(html.includes(`rel="canonical" href="${META.pagesUrl}${locale.path}sites/flushapi/"`));
    assert.ok(html.includes('href="../../../sites/flushapi/"'));
  });
  test(`${locale.id}：翻译与模型内容不能注入 HTML 或提前闭合 JSON-LD`, () => {
    const hostile = structuredClone(catalog);
    hostile.sites.flushapi.summary = '<img src=x onerror=alert(1)> </script>';
    const html = renderLocalizedHome({ ...args, catalog: hostile });
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img'));
    assert.doesNotThrow(() => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]));
  });
}

// ──────────────────────────────────────────────────────────────────────
// 一键配置脚本：写进用户 rc 文件的东西，错一个字就是 Claude Code 连不上
// ──────────────────────────────────────────────────────────────────────

console.log('quickstart：一键配置脚本');

const QS_SH = await readFile(new URL('./quickstart.sh', import.meta.url), 'utf8');
const QS_PS1 = await readFile(new URL('./quickstart.ps1', import.meta.url));
// 在临时 HOME 里真跑一遍 bash 脚本：站名带空格、换站重跑、危险字符的 Key
const HAS_BASH = !spawnSync('bash', ['--version']).error;
const QS_HOME = await mkdtemp(path.join(os.tmpdir(), 'acw-quickstart-'));
await mkdir(path.join(QS_HOME, 'scripts'));
await mkdir(path.join(QS_HOME, 'data'));
await writeFile(path.join(QS_HOME, 'scripts', 'quickstart.sh'), QS_SH);
await writeFile(path.join(QS_HOME, 'data', 'sites.json'), JSON.stringify({ sites: [
  { id: 'ar', name: 'AgentRouter', subtitle: 'a', endpoints: { anthropic: 'https://ar.example' }, signupUrl: 'https://ar.example/r' },
  { id: 'kk', name: 'KKtoken AI', subtitle: '站名带空格', endpoints: { anthropic: 'https://kk.example' }, signupUrl: 'https://kk.example/sign-up' },
] }));
await writeFile(path.join(QS_HOME, 'data', 'live.json'), JSON.stringify({ sites: [{ id: 'kk', defaults: { claude: 'claude-opus-5' } }] }));
await writeFile(path.join(QS_HOME, '.zshrc'), 'alias ll="ls -l"\n');
// LC_ALL 用 UTF-8：「$RC，」那个崩溃只在 UTF-8 locale 下出现，C locale 测不出来
const runQs = (input) => spawnSync('bash', [path.join(QS_HOME, 'scripts', 'quickstart.sh')], {
  input, encoding: 'utf8', env: { ...process.env, HOME: QS_HOME, SHELL: '/bin/zsh', LC_ALL: 'en_US.UTF-8' },
});
const qsRuns = HAS_BASH
  ? [runQs('2\nsk-test-1111aaaa\n\ny\n'), runQs('2\nsk-test-2222bbbb\n\ny\n'), runQs('9\n'), runQs('1\nsk-$(touch PWNED)\n\ny\n')]
  : [];
const qsRc = HAS_BASH ? await readFile(path.join(QS_HOME, '.zshrc'), 'utf8') : '';
const qsPwned = HAS_BASH && (await readdir(QS_HOME)).includes('PWNED');
await rm(QS_HOME, { recursive: true, force: true });

test('quickstart.ps1 带 UTF-8 BOM：Windows PowerShell 5.1 读无 BOM 的脚本按 GBK 解析，中文全乱码', () => {
  assert.deepEqual([...QS_PS1.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
test('quickstart.sh 里 $变量 后面不能直接跟中文：bash 3.2 在 UTF-8 下会把半个汉字吃进变量名', () => {
  assert.deepEqual(QS_SH.split('\n').filter((l) => /\$[A-Za-z_]\w*[^\x00-\x7f]/.test(l)), []);
});
if (HAS_BASH) {
  const [first, second, badIndex, badKey] = qsRuns;
  test('站名带空格（KKtoken AI）时 Base URL 和模型名不错位，且正常退出', () => {
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /ANTHROPIC_BASE_URL="https:\/\/kk\.example"/);
    assert.match(first.stdout, /ANTHROPIC_MODEL="claude-opus-5"/);
    assert.ok(!first.stdout.includes('sk-test-1111aaaa'), '屏幕上的 Key 要打码');
  });
  test('重跑只替换脚本自己写的配置块：不叠出两份，旧 Key 不留在 rc 里，用户自己的配置不动', () => {
    assert.equal(second.status, 0, second.stderr);
    assert.equal(qsRc.match(/^# >>> ai-coding-welfare/gm)?.length, 1);
    assert.ok(qsRc.includes('sk-test-2222bbbb') && !qsRc.includes('sk-test-1111aaaa'));
    assert.ok(qsRc.startsWith('alias ll="ls -l"\n\n# >>> ai-coding-welfare: KKtoken AI >>>\n'));
  });
  test('编号无效直接退出；Key 带 $( ) 这类字符拒绝写入 rc（写进去每开一次终端就执行一次）', () => {
    assert.notEqual(badIndex.status, 0);
    assert.match(badIndex.stderr, /编号无效/);
    assert.notEqual(badKey.status, 0);
    assert.match(badKey.stdout, /Key 里有空格、引号/);
    assert.ok(!qsRc.includes('PWNED'), '危险 Key 不能落进 rc 文件');
    assert.equal(qsPwned, false);
  });
} else {
  console.log('  · 没有 bash，跳过 quickstart.sh 的实跑用例');
}

console.log(`\n${process.exitCode ? '✘ 有用例失败' : `✔ 全部通过（${passed} 项）`}`);
