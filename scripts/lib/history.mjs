/**
 * 站点可用性的时间序列。
 *
 * live.json 只有「现在」，但用户真正想知道的是「这个站稳不稳」——
 * 这条历史是别人 fork 这个仓库也抄不走的东西（要靠时间攒），
 * 所以单独压成 data/history.json 存起来，别指望从 git 历史里现算：
 * CI 用的是 shallow clone，拿不到全部历史（回填走 `--backfill`，见 scripts/history.mjs）。
 *
 * 每条样本只留判断可用性必需的字段，一天 4 个点、按站点 6 个，
 * 存一年也就几百 KB，可以放心提交进仓库。
 */

/** 一份 live.json → 一条历史样本 */
export function compact(live) {
  return {
    at: live?.generatedAt ?? new Date().toISOString(),
    sites: Object.fromEntries(
      (live?.sites ?? []).map((s) => [
        s.id,
        {
          up: Boolean(s.online),
          // 被 WAF 拦下时 up 沿用的是上次结果，可用性统计要如实标注，不能当成一次成功探测
          blocked: s.probeBlocked === true,
          models: s.models?.length ?? 0,
          latency: s.latencyMs ?? null,
        },
      ]),
    ),
  };
}

export const EMPTY_HISTORY = { updatedAt: null, samples: [] };

/**
 * 追加一条样本。同一个 generatedAt 只保留一条（CI 重跑、本地重复 build 都不该产生重复点）。
 * limit 按样本数截断：6 小时一次 → 1500 条约等于一年。
 */
export function appendSample(history, live, { limit = 1500 } = {}) {
  const samples = [...(history?.samples ?? [])];
  const sample = compact(live);
  const idx = samples.findIndex((s) => s.at === sample.at);
  const added = idx < 0;
  if (added) samples.push(sample);
  else samples[idx] = sample;
  samples.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return {
    history: { updatedAt: sample.at, samples: samples.slice(-limit) },
    added,
    sample,
  };
}

/**
 * 比对用的「上一版」只认 CI 自己观测过的东西。
 *
 * scripts/history.mjs 拿 HEAD 里的 live.json 当上一版，可那份文件可能是本地跑出来、随手一起提交的。
 * 本机网络和 CI 不一样（有的站国内直连不通，有的只有走代理才通），拿它当基线就会报出假的掉线 / 恢复，
 * 新收录的站还会因为「上一版里已经有它」而漏掉收录事件。2026-09-30 加 Conduit 时，本地探测
 * t.me 失败的快照被一起提交，Release 发成了「Conduit 恢复在线」，真正的消息「新收录 Conduit：
 * 注册送 $500」一条都没发出去；09-23 的「Matrix 探测不到了」→ 24 分钟后「恢复在线」也是这个来历。
 *
 * history.json 的样本只由 CI 追加（scripts/history.mjs 在 CI 外拒绝写入），所以：
 *   - 历史样本里从没出现过的站，从基线里拿掉 → diffSnapshots 会如实记一条「新收录」
 *   - 在线状态改用历史里该站最后一次的观测值，不用 HEAD 快照里的 online
 * 内容字段（额度、模型、价格、注册开关）照旧和 HEAD 快照比：本地抓失败时 merge.mjs 会沿用旧值，
 * 抓成功了就是真数据，造不出假变动。
 */
export function ciBaseline(prev, history) {
  const samples = history?.samples ?? [];
  // 还没有任何历史（首次运行 / 手动清空过）就没有可信的基准可换，原样比
  if (!prev || !samples.length) return prev;
  const lastUp = new Map();
  for (const s of [...samples].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    for (const [id, r] of Object.entries(s.sites ?? {})) lastUp.set(id, Boolean(r?.up));
  }
  return {
    ...prev,
    sites: (prev.sites ?? []).filter((s) => lastUp.has(s.id)).map((s) => ({ ...s, online: lastUp.get(s.id) })),
  };
}

const dayOf = (iso) => String(iso ?? '').slice(0, 10);

/** 取最近 days 天的样本（按样本自带时间戳算，不依赖当前时钟之外的东西） */
export function recent(history, days = 7, now = Date.now()) {
  const from = now - days * 86_400_000;
  return (history?.samples ?? []).filter((s) => {
    const t = new Date(s.at).getTime();
    return Number.isFinite(t) && t >= from;
  });
}

/**
 * 某站最近 days 天的可用性：总样本、在线样本、被拦样本。
 * ratio 只在有样本时给数，样本太少（< 4，即不足一天）时 enough=false，
 * 页面上要据此说「样本还不够」，不能拿 2 个点吹 100% 可用。
 */
export function uptime(history, siteId, days = 7, now = Date.now()) {
  const rows = recent(history, days, now).map((s) => s.sites?.[siteId]).filter(Boolean);
  const total = rows.length;
  const up = rows.filter((r) => r.up).length;
  const blocked = rows.filter((r) => r.blocked).length;
  return {
    total,
    up,
    blocked,
    enough: total >= 4,
    ratio: total ? up / total : null,
    percent: total ? Math.round((up / total) * 1000) / 10 : null,
  };
}

/** 按天分桶，给状态页画条形图用；缺样本的那天 total = 0，页面显示成空档而不是掉线 */
export function byDay(history, siteId, days = 7, now = Date.now()) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.set(new Date(now - i * 86_400_000).toISOString().slice(0, 10), { up: 0, total: 0, blocked: 0 });
  }
  for (const s of recent(history, days, now)) {
    const b = buckets.get(dayOf(s.at));
    const r = s.sites?.[siteId];
    if (!b || !r) continue;
    b.total += 1;
    if (r.up) b.up += 1;
    if (r.blocked) b.blocked += 1;
  }
  return [...buckets.entries()].map(([date, b]) => ({
    date,
    ...b,
    ratio: b.total ? b.up / b.total : null,
  }));
}

/** 覆盖时长：这条历史一共记了多久，用来在页面上说清样本量 */
export function coverage(history) {
  const s = history?.samples ?? [];
  if (!s.length) return { samples: 0, from: null, to: null, days: 0 };
  const from = s[0].at;
  const to = s[s.length - 1].at;
  const days = Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
  return { samples: s.length, from, to, days: Math.round(days * 10) / 10 };
}
