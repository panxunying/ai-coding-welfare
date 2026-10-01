#!/usr/bin/env node
/**
 * 归档可用性历史 + 生成变动日志。
 *   node scripts/history.mjs             # 增量：追加当前快照，和上一次提交的快照比对出变动
 *   node scripts/history.mjs --backfill  # 回填：从 git 历史里把 data/live.json 的每一版都走一遍
 *
 * 增量模式为什么用 `git show HEAD:data/live.json` 取上一版：CI 是 shallow clone，
 * 但 HEAD 的文件树一定在，而 refresh 刚好把工作区的 live.json 覆盖成了新版，
 * 两者一比就是这 6 小时的变化，不需要额外存一份副本。HEAD 那份可能是本地提交的，
 * 所以比对前先过一遍 ciBaseline（见 lib/history.mjs）。
 *
 * 只在 CI 里写：本机网络和 GitHub Actions 不一样，本地探测的在线状态混进可用性历史、
 * 变动日志和 Release，就是发给订阅者的假消息（09-01 / 09-15 / 09-23 / 09-30 都翻过车）。
 * 本地运行默认什么都不写、直接退出 0，`npm run all` 照常往下走；确需本地写入加 --local。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { diffSnapshots, majorOnly } from './lib/diff.mjs';
import { appendSample, ciBaseline, EMPTY_HISTORY } from './lib/history.mjs';
import { groupByDay, renderChangelogMd, renderReleaseNotes, summarize } from './lib/changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);
const BACKFILL = process.argv.includes('--backfill');
const EVENT_CAP = 1000;

if (!BACKFILL && process.env.GITHUB_ACTIONS !== 'true' && !process.argv.includes('--local')) {
  console.log(
    '· 本地运行，不写入 data/history.json / data/changelog.json / CHANGELOG.md：\n' +
      '  本机网络和 CI 不一样，本地探测的结果混进可用性历史与变动日志就是假数据。\n' +
      '  推送后 CI 会重新探测并记录；确需在本地写入（比如修补历史），加 --local。',
  );
  process.exit(0);
}

const readJson = async (rel, fallback = null) => {
  try {
    return JSON.parse(await readFile(p(rel), 'utf8'));
  } catch {
    return fallback;
  }
};

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const { meta, sites } = await readJson('data/sites.json', { meta: {}, sites: [] });
const live = await readJson('data/live.json');
if (!live) throw new Error('找不到 data/live.json，先跑 `npm run refresh`');

/** 第一份快照没有「上一版」可比，就把当时收录的站点如实记成一批收录事件 */
const initialEvents = (snapshot) => diffSnapshots({ sites: [] }, snapshot, sites);

let history = (await readJson('data/history.json')) ?? EMPTY_HISTORY;
let events = (await readJson('data/changelog.json'))?.events ?? [];
let fresh = [];

if (BACKFILL) {
  history = EMPTY_HISTORY;
  events = [];
  const shas = git(['log', '--reverse', '--format=%H', '--', 'data/live.json']).split('\n').filter(Boolean);
  let prev = null;
  let walked = 0;
  for (const sha of shas) {
    let snap;
    try {
      snap = JSON.parse(git(['show', `${sha}:data/live.json`]));
    } catch {
      continue; // 那一版是坏的或还不存在，跳过，不能让整次回填失败
    }
    if (!snap?.generatedAt || snap.generatedAt === prev?.generatedAt) continue;
    events.push(...(prev ? diffSnapshots(prev, snap, sites) : initialEvents(snap)));
    history = appendSample(history, snap).history;
    prev = snap;
    walked += 1;
  }
  // 工作区的这一版可能还没提交，补进去
  if (prev && live.generatedAt !== prev.generatedAt) {
    events.push(...diffSnapshots(prev, live, sites));
    history = appendSample(history, live).history;
  } else if (!prev) {
    events.push(...initialEvents(live));
    history = appendSample(history, live).history;
  }
  console.log(`✔ 回填完成：走过 ${walked} 版 live.json，得到 ${events.length} 条变动`);
} else {
  let prev = null;
  try {
    prev = JSON.parse(git(['show', 'HEAD:data/live.json']));
  } catch {
    console.warn('⚠ 拿不到 HEAD 里的 data/live.json（首次提交或非 git 环境），本次不比对变动。');
  }
  const seen = new Set(events.map((e) => `${e.at}|${e.siteId}|${e.type}|${e.text}`));
  // HEAD 里那份可能是本地提交的：在线状态与「是不是新站」只认 CI 攒下的历史样本
  const base = prev ? ciBaseline(prev, history) : history.samples.length ? null : { sites: [] };
  if (base) {
    fresh = diffSnapshots(base, live, sites).filter((e) => !seen.has(`${e.at}|${e.siteId}|${e.type}|${e.text}`));
    events.push(...fresh);
  }
  const r = appendSample(history, live);
  history = r.history;
  console.log(
    `✔ 历史样本 ${history.samples.length} 条（本次${r.added ? '新增' : '覆盖同时间点'}）；本次新增变动 ${fresh.length} 条`,
  );
}

// 时间倒序存，页面和 feed 都是最新在前
events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
events = events.slice(0, EVENT_CAP);

await writeFile(p('data', 'history.json'), `${JSON.stringify(history)}\n`, 'utf8');
await writeFile(
  p('data', 'changelog.json'),
  `${JSON.stringify({ updatedAt: live.generatedAt, events }, null, 0)}\n`,
  'utf8',
);
await writeFile(p('CHANGELOG.md'), `${renderChangelogMd({ meta, groups: groupByDay(events) })}\n`, 'utf8');
console.log(`✔ CHANGELOG.md 已生成（共 ${events.length} 条变动）`);

// 只有「会影响值不值得注册」的变动才配得上一次 Release / 一条推送
const major = majorOnly(BACKFILL ? [] : fresh);
if (major.length) {
  const stamp = (live.generatedAt ?? new Date().toISOString()).replace(/[-:]/g, '').replace(/T(\d{4}).*/, '-$1');
  const tag = `data-${stamp}`;
  const title = summarize(major);
  await mkdir(p('.tmp'), { recursive: true });
  await writeFile(p('.tmp', 'release-notes.md'), `${renderReleaseNotes({ meta, events: major, live })}\n`, 'utf8');
  await writeFile(p('.tmp', 'notify.json'), `${JSON.stringify({ tag, title, events: major })}\n`, 'utf8');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `major=${major.length}\ntag=${tag}\ntitle=${title.replace(/\n/g, ' ')}\n`);
  }
  console.log(`✔ 重要变动 ${major.length} 条 → ${tag}：${title}`);
} else {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'major=0\n');
  console.log('· 本次没有重要变动，不发 Release。');
}
