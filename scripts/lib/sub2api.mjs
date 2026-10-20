/**
 * 抓取 sub2api 自研面板（github.com/Wei-Shaw/sub2api，本页收录的 Happy Code 这一类）
 * 的公开站点配置。它不是 New API 系：/api/status 与 /api/pricing 一律 404，
 * 公开可读的 JSON 是前端的站点配置：
 *
 *   GET /api/v1/settings/public
 *   {"code":0,"message":"success","data":{
 *      "registration_enabled":true,"email_verify_enabled":true,
 *      "registration_email_suffix_whitelist":["@qq.com","@gmail.com",…],
 *      "site_name":"Happy Code","version":"0.0.103","payment_enabled":true,
 *      "oidc_oauth_enabled":true,"oidc_oauth_provider_name":"NodeLoc",
 *      "github_oauth_enabled":false,…,"turnstile_enabled":false,…}}
 *   （2026-10-20 从 happycodeai.com 实测截取）
 *
 * 这个接口能给的就如实用：站名、面板版本、注册总闸、充值开关和各家 OAuth 开关。
 * 模型清单、价格、签到金额它都不含（定价登录后才看），一律留 null / []，
 * 绝不从 sites.json 倒灌进 live.json 假装是探测结果——同 lib/matrix.mjs 的分寸。
 *
 * 成功口径对齐 vibecode：HTTP 200 且 code=0 才当数据用；code 非 0 说明接口
 * 变过或返回了业务错误，如实写进 error，不当在线证据。
 */
import { blankSnapshot, fetchJson } from './newapi.mjs';

/** HTTP 通了还不够，业务层也得是 code=0 才算数 */
export function sub2apiState(res) {
  if (!res?.ok) return { ok: false, error: res?.error ?? 'unreachable' };
  const payload = res.json;
  if (payload?.code !== 0 || typeof payload?.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
    return { ok: false, error: `返回 code=${payload?.code ?? '缺失'}（${payload?.message ?? '无 message'}）` };
  }
  return { ok: true, error: null };
}

/** get 可注入，单测直接喂真实返回体的形状，不联网 */
export async function probeSub2Api(site, get = fetchJson) {
  const res = await get(site.statusApi);
  const { ok, error } = sub2apiState(res);

  // 字段集合必须与 blankSnapshot 完全一致（merge.mjs 与渲染器按字段取数）
  const snapshot = blankSnapshot(site, {
    apiOk: ok,
    pricingOk: false,
    latencyMs: res?.ms ?? null,
    error,
  });
  if (!ok) return snapshot;

  const d = res.json.data;
  snapshot.systemName = typeof d.site_name === 'string' && d.site_name.trim() ? d.site_name : null;
  snapshot.version = typeof d.version === 'string' && d.version.trim() ? d.version : null;
  snapshot.registerOpen = typeof d.registration_enabled === 'boolean' ? d.registration_enabled : null;
  // sub2api 的内建注册表单就是邮箱 + 密码，registration_enabled 是它与 OAuth 建号共用的总闸
  snapshot.passwordRegister = snapshot.registerOpen;
  snapshot.topupEnabled = typeof d.payment_enabled === 'boolean' ? d.payment_enabled : null;
  snapshot.loginMethods = [
    d.github_oauth_enabled && 'GitHub',
    d.google_oauth_enabled && 'Google',
    d.linuxdo_oauth_enabled && 'LinuxDO',
    d.dingtalk_oauth_enabled && '钉钉',
    (d.wechat_oauth_enabled || d.wechat_oauth_open_enabled || d.wechat_oauth_mp_enabled) && '微信',
    d.oidc_oauth_enabled && (d.oidc_oauth_provider_name ? `OIDC（${d.oidc_oauth_provider_name}）` : 'OIDC'),
    d.passkey_enabled && 'Passkey',
    // 邮箱 + 密码是 sub2api 的内建登录（/auth/login、password_reset 都是面板固有路由），
    // 不依赖任何开关字段，与各家 OAuth 开关并列登记
    '账号密码',
  ].filter(Boolean);
  return snapshot;
}
