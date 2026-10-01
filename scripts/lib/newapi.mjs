/**
 * 抓取 New API / One API 系列站点的公开信息（零依赖，Node 18+ 自带 fetch）。
 *
 * 只读取站点自己公开暴露的接口：
 *   GET /api/status   —— 站名、版本、注册方式、邀请额度、公告
 *   GET /api/pricing  —— 模型清单与倍率（部分站点要求登录，拿不到就跳过）
 *
 * 同时兼做各面板共用的探测底座：fetchJson / blankSnapshot / pickPreferred / staleHours
 * 都被 lib/vibecode.mjs、lib/merge.mjs 与渲染器复用，改动时留意调用方。
 */

// UA 里带上仓库地址：站长在访问日志里看到它，能顺着找到是谁、为什么定时来探测
export const PROJECT_URL = 'https://github.com/panxunying/ai-coding-welfare';
const UA = `ai-coding-welfare/1.0 (+${PROJECT_URL})`;
// 探测注册页 / 备用域名首页时用的标识，和拉接口区分开，方便站长在日志里认出来
const LINK_UA = `ai-coding-welfare/1.0 link-check (+${PROJECT_URL})`;
const TIMEOUT_MS = 20_000;
// 公益站前面普遍挂着 Cloudflare，CI 的机房 IP 偶发拿到挑战页（表现为 invalid json / 403），重试基本能救回来
const RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 把 fetch 抛出的异常写成一句能看懂的话。
 * undici 不论什么原因都只报一句「fetch failed」，真正的病因藏在 err.cause 里：
 * 证书和域名对不上（ERR_TLS_CERT_ALTNAME_INVALID）、DNS 解析不了（ENOTFOUND）、连接被拒……
 * 2026-09-25 起 DoCode 新注册链接的证书只签了 docode.cc，巡检日志却天天只写「fetch failed」，
 * 光看日志根本分不清是证书问题还是站点挂了。超时两种写法（AbortController / AbortSignal.timeout）统一成 timeout。
 */
export function describeFetchError(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout';
  const message = String(err?.message || err);
  const cause = err?.cause?.code ?? err?.cause?.message;
  return cause && !message.includes(cause) ? `${message} (${cause})` : message;
}

async function fetchOnce(url) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const ms = Date.now() - started;
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, ms, error: `HTTP ${res.status}` };
    try {
      return { ok: true, status: res.status, ms, json: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, ms, error: 'invalid json' };
    }
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: describeFetchError(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 出网前先钉死协议：只走 https。
 *
 * data/sites.json 是外部 PR 能改的文件，里面每个 URL 都会被 CI 拿去 fetch
 * （CodeQL 的 js/file-access-to-http 指的就是这条「文件数据流进网络请求」的链）。
 * 这些请求不带任何密钥，所以漏不了东西；但把协议钉死能一次挡掉 file: 读本地文件、
 * http: 明文回落、以及拿它去探运行器内网这一类玩法，成本只有一次 URL 解析。
 */
export function isHttpsUrl(url) {
  try {
    return new URL(String(url)).protocol === 'https:';
  } catch {
    return false;
  }
}

/** 带超时 + 重试的 JSON 拉取，失败返回 { ok:false }，不抛异常。 */
export async function fetchJson(url) {
  if (!url) return { ok: false, error: 'no url' };
  if (!isHttpsUrl(url)) return { ok: false, status: 0, error: '只允许 https 出网' };
  let last = { ok: false, error: 'unreachable' };
  for (let i = 0; i <= RETRIES; i += 1) {
    if (i) await sleep(1500 * i);
    last = await fetchOnce(url);
    if (last.ok) return { ...last, attempts: i + 1 };
  }
  return { ...last, attempts: RETRIES + 1 };
}

/**
 * 探测一个网页是否可访问（注册页 / 备用域名首页），返回 { status, ok, ms }。
 *
 * 和 fetchJson 一样带重试，理由是 online 按「接口或注册页有一个通」算：
 * 网络抖一下就把注册页判成 HTTP 0，遇上接口同时被 WAF 拦的站点就会被误标异常。
 * 但只重试「连接层面的异常」——服务器给了 HTTP 响应就立刻返回，
 * 403 / 429 是 looksFiltered 判断「被拦而非下线」的依据，重试反而会把它抹掉。
 *
 * fetchImpl / backoffMs 可注入，单测不联网也不用等退避。
 */
export async function probeUrl(url, { ua = LINK_UA, retries = RETRIES, backoffMs = 1500, fetchImpl = fetch } = {}) {
  if (!url) return null;
  if (!isHttpsUrl(url)) return { status: 0, ok: false, ms: 0, error: '只允许 https 出网', attempts: 0 };
  let last = null;
  for (let i = 0; i <= retries; i += 1) {
    if (i) await sleep(backoffMs * i);
    const started = Date.now();
    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': ua },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: res.status, ok: res.ok, ms: Date.now() - started, attempts: i + 1 };
    } catch (err) {
      last = { status: 0, ok: false, ms: Date.now() - started, error: describeFetchError(err), attempts: i + 1 };
    }
  }
  return last;
}

/**
 * New API 的计价约定：倍率 1 == $0.002 / 1K tokens == $2 / 1M tokens。
 * 输出价 = 倍率 * 补全倍率 * $2 / 1M tokens。
 */
export const RATIO_USD_PER_MTOK = 2;

function money(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 1000;
}

function normalizeAnnouncements(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a.content === 'string' && a.content.trim())
    .slice(0, 5)
    .map((a) => ({
      id: a.id ?? null,
      date: typeof a.publishDate === 'string' ? a.publishDate.slice(0, 10) : null,
      text: a.content.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 220),
    }));
}

function normalizeModels(pricing) {
  if (!Array.isArray(pricing)) return [];
  return pricing
    .filter((m) => m && m.model_name)
    .map((m) => {
      const ratio = Number(m.model_ratio);
      const compl = Number(m.completion_ratio);
      const fixed = Number(m.model_price) > 0;
      return {
        name: String(m.model_name),
        ratio: Number.isFinite(ratio) ? ratio : null,
        completionRatio: Number.isFinite(compl) ? compl : null,
        fixedPrice: fixed ? Number(m.model_price) : null,
        inputPerMTok: fixed ? null : money(ratio * RATIO_USD_PER_MTOK),
        outputPerMTok: fixed ? null : money(ratio * compl * RATIO_USD_PER_MTOK),
        groups: Array.isArray(m.enable_groups) ? m.enable_groups : [],
        protocols: Array.isArray(m.supported_endpoint_types) ? m.supported_endpoint_types : [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 版本号比较用：从模型名里抽出数字序列，claude-opus-5 → [5]，claude-opus-4-8 → [4,8] */
function versionKey(name) {
  return (name.match(/\d+/g) ?? []).map(Number);
}

/** 在候选模型里挑「版本最新」的一个，用于示例配置与一键脚本的默认值 */
export function pickPreferred(models, re) {
  const hits = (models ?? []).filter((m) => re.test(m.name));
  if (!hits.length) return null;
  return hits.sort((a, b) => {
    const [x, y] = [versionKey(a.name), versionKey(b.name)];
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const d = (y[i] ?? -1) - (x[i] ?? -1);
      if (d) return d;
    }
    return a.name.localeCompare(b.name);
  })[0].name;
}

/**
 * 数据沿用旧快照是否需要在页面上提示。
 * 接口偶发被 Cloudflare 拦（尤其 CI 的机房 IP）是常态，几小时内的快照照常展示；
 * 只有超过 STALE_WARN_HOURS 还没抓到新数据，才在页面上如实标注。
 */
export const STALE_WARN_HOURS = 48;

/**
 * 「被 WAF 过滤」而不是「站点挂了」的信号。
 * 这些响应说明服务器确实答话了，只是把我们这个 IP 拦在门外——
 * GitHub Actions 的机房 IP 尤其容易吃 403 / 429，家宽访问同一个域名一切正常。
 * 真下线长的是另一副样子：DNS 解析不了、连接被拒、超时、502 / 504 网关错误。
 */
export const FILTERED_STATUS = new Set([403, 429, 451, 503]);

export function looksFiltered(res) {
  if (!res || res.ok) return false;
  if (FILTERED_STATUS.has(Number(res.status))) return true;
  // Cloudflare 挑战页：HTTP 200 却不是 JSON
  return Number(res.status) === 200 && res.error === 'invalid json';
}

export function staleHours(snap) {
  if (!snap?.dataStale || !snap.staleFrom) return null;
  const h = (Date.now() - new Date(snap.staleFrom).getTime()) / 3_600_000;
  return Number.isFinite(h) && h > STALE_WARN_HOURS ? Math.round(h) : null;
}

/**
 * 所有面板共用的快照骨架。
 * 字段集合必须保持稳定：merge.mjs 按字段决定「沿用旧值还是用新值」，
 * 渲染器也直接按这些字段取数，少一个字段页面上就会出现 undefined。
 */
export function blankSnapshot(site, { apiOk, pricingOk, latencyMs, error }) {
  return {
    id: site.id,
    checkedAt: new Date().toISOString(),
    apiOk: Boolean(apiOk),
    pricingOk: Boolean(pricingOk),
    latencyMs: latencyMs ?? null,
    error: error ?? null,
    systemName: null,
    version: null,
    registerOpen: null,
    passwordRegister: null,
    checkinEnabled: null,
    loginMethods: [],
    githubMinAccountAgeDays: null,
    quotaPerUnit: null,
    inviteeBonusUsd: null,
    inviterBonusUsd: null,
    topupEnabled: null,
    services: [],
    announcements: [],
    models: [],
    modelsSource: pricingOk ? 'public-api' : 'login-required',
    defaults: { claude: null, openai: null },
  };
}

/** 把 /api/status 与 /api/pricing 合成一条站点实时快照。get 可注入，便于单测不联网。 */
export async function probeNewApi(site, get = fetchJson) {
  const [statusRes, pricingRes] = await Promise.all([
    get(site.statusApi),
    site.pricingApi ? get(site.pricingApi) : Promise.resolve({ ok: false, error: 'not public' }),
  ]);

  const snapshot = blankSnapshot(site, {
    apiOk: statusRes.ok,
    pricingOk: pricingRes.ok,
    latencyMs: statusRes.ms ?? null,
    error: statusRes.ok ? null : statusRes.error ?? null,
  });
  snapshot.models = normalizeModels(pricingRes.ok ? pricingRes.json?.data : null);

  const d = statusRes.ok ? statusRes.json?.data ?? {} : {};
  const per = Number(d.quota_per_unit) || null;
  Object.assign(snapshot, {
    systemName: d.system_name ?? null,
    version: d.version ?? null,
    registerOpen: typeof d.register_enabled === 'boolean' ? d.register_enabled : null,
    passwordRegister: typeof d.password_register_enabled === 'boolean' ? d.password_register_enabled : null,
    checkinEnabled: typeof d.checkin_enabled === 'boolean' ? d.checkin_enabled : null,
    githubMinAccountAgeDays: Number(d.github_minimum_account_age_days) || null,
    quotaPerUnit: per,
    inviteeBonusUsd: per && Number(d.quota_for_invitee) ? money(Number(d.quota_for_invitee) / per) : null,
    inviterBonusUsd: per && Number(d.quota_for_inviter) ? money(Number(d.quota_for_inviter) / per) : null,
    topupEnabled: typeof d.enable_online_topup === 'boolean' ? d.enable_online_topup : null,
    announcements: normalizeAnnouncements(d.announcements),
    loginMethods: [
      d.github_oauth && 'GitHub',
      d.linuxdo_oauth && 'LinuxDO',
      d.discord_oauth && 'Discord',
      d.telegram_oauth && 'Telegram',
      d.wechat_login && '微信',
      d.oidc_enabled && 'OIDC',
      d.passkey_login && 'Passkey',
      d.password_login_enabled && '账号密码',
    ].filter(Boolean),
  });

  // 给 README / 落地页 / 一键脚本用的默认模型名，抓不到就留 null 由调用方兜底
  snapshot.defaults = {
    claude: pickPreferred(snapshot.models, /^claude/i),
    // 站点只上了 claude 系（如 TaBiAI）时也得给 OpenAI 协议一个示例模型名：
    // 兜底同样走 pickPreferred 挑版本最新的，不能用 models[0]——那是字母序，
    // claude-opus-4-8 会排在 claude-opus-5 前面，示例配置就成了旧型号。
    openai: pickPreferred(snapshot.models, /^(gpt|o\d|glm|deepseek|qwen|kimi)/i) ?? pickPreferred(snapshot.models, /./) ?? null,
  };

  return snapshot;
}
