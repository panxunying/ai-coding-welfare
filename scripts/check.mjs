#!/usr/bin/env node
/**
 * 健康检查：确认每个站点的首页、注册（邀请）链接、状态接口都还活着。
 *   node scripts/check.mjs
 * 注册链接挂掉时以非 0 退出，让 CI 直接报警——推广页最怕的就是死链。
 *
 * 例外：403 / 429 / 503 这类「服务器答话了但把我们拦了」的响应不算死链。
 * GitHub Actions 的机房 IP 常被公益站的 WAF 拦，家宽访问同一个链接一切正常，
 * 拿它报警只会天天误报，所以单独计一类「被拦」，只提示不失败。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { looksFiltered, probeUrl, PROJECT_URL } from './lib/newapi.mjs';
import { activeSites } from './lib/archived.mjs';
import { signupProbeUrl } from './lib/signup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 归档（已挂掉）的站点不检查：域名都死了，天天报「关键链接不可用」只会把告警刷成噪音
const { sites: allSites } = JSON.parse(await readFile(path.join(ROOT, 'data', 'sites.json'), 'utf8'));
const sites = activeSites(allSites);
const archived = allSites.length - sites.length;

const HEALTH_UA = `ai-coding-welfare/1.0 health-check (+${PROJECT_URL})`;

/**
 * 和 refresh 共用 lib/newapi.mjs 的 probeUrl：只允许 https；连接层异常（DNS 抖动、连接被重置）
 * 退避重试，服务器一答话就立刻返回，403 / 429 原样留给 looksFiltered 判「被拦」。
 * 巡检失败会在仓库里公开开 Issue，不能让一次网络抖动就喊「死链」。
 */
const probe = async (url) => (await probeUrl(url, { ua: HEALTH_UA })) ?? { ok: false, status: 0, ms: 0, error: 'no url' };

const targets = [];
for (const s of sites) {
  targets.push({ site: s.name, kind: s.signupProbeUrl ? '公开入口（替代邀请路径）' : '注册链接', url: signupProbeUrl(s), critical: true });
  targets.push({ site: s.name, kind: '站点首页', url: s.homeUrl, critical: true });
  // relay 面板的 statusApi 是个「要鉴权的中转口」，不带 key 回 401 才是正常的（见 lib/relay.mjs）。
  // 不把这一类算进告警，否则每次 check 都固定挂一条噪音，久了就没人看告警了。
  if (s.statusApi) {
    targets.push({
      site: s.name,
      kind: '状态接口',
      url: s.statusApi,
      critical: false,
      expect401: s.panel === 'relay',
    });
  }
  if (s.docsUrl) targets.push({ site: s.name, kind: '文档', url: s.docsUrl, critical: false });
  for (const m of s.mirrors ?? []) {
    targets.push({ site: s.name, kind: '备用注册', url: m.signupUrl, critical: false });
  }
}

const results = await Promise.all(targets.map(async (t) => ({ ...t, res: await probe(t.url) })));

let failed = 0;
let warned = 0;
let blocked = 0;
for (const r of results) {
  const needsKey = r.expect401 && r.res.status === 401;
  const alive = r.res.ok || needsKey;
  const filtered = !alive && looksFiltered(r.res);
  const mark = alive ? '✔' : filtered ? '≡' : r.critical ? '✖' : '!';
  if (!alive) {
    if (filtered) blocked += 1;
    else if (r.critical) failed += 1;
    else warned += 1;
  }
  console.log(
    `${mark} ${r.site.padEnd(13)} ${r.kind.padEnd(10)} HTTP ${String(r.res.status).padEnd(4)} ` +
      `${String(r.res.ms).padStart(5)}ms  ${r.url}${r.res.error ? `  (${r.res.error})` : ''}` +
      `${needsKey ? '  ← 中转口要鉴权，401 是预期答案' : ''}` +
      `${filtered ? '  ← 被 WAF 拦（本机 IP 的问题，不算死链）' : ''}`,
  );
}

console.log(`\n共 ${results.length} 项：失败 ${failed}，告警 ${warned}，被拦 ${blocked}`);
if (archived) console.log(`⚰ ${archived} 个已归档（挂掉）的站点跳过检查`);
if (blocked) {
  console.log('被拦的链接请换个网络（非机房 IP）复核一次，站点通常是好的。');
}
if (failed) {
  console.error('\n关键链接不可用，请核对 data/sites.json 里的推广链接是否已失效或换域名。');
  process.exit(1);
}
