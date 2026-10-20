/**
 * 面板类型 → 探测函数的路由表。
 * sites.json 里用 panel 字段选，不填就按 New API 处理（收录的多数站点都是它）。
 * 新增一种面板只要写一个返回 blankSnapshot 形状的 probe，再登记到这里。
 */
import { probeNewApi } from './newapi.mjs';
import { probeVibeCode } from './vibecode.mjs';
import { probeMatrix } from './matrix.mjs';
import { probeRelay } from './relay.mjs';
import { probeSub2Api } from './sub2api.mjs';

export const PANELS = {
  newapi: probeNewApi,
  vibecode: probeVibeCode,
  matrix: probeMatrix,
  relay: probeRelay,
  sub2api: probeSub2Api,
};

export const DEFAULT_PANEL = 'newapi';

/** get 可选，透传给具体 probe——单测靠它喂真实返回体，不联网 */
export function probeSite(site, get) {
  const probe = PANELS[site.panel ?? DEFAULT_PANEL];
  if (!probe) throw new Error(`${site.id}: 未知的面板类型 ${site.panel}（可选 ${Object.keys(PANELS).join(' / ')}）`);
  return get ? probe(site, get) : probe(site);
}
