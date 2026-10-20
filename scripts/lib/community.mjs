import { esc } from './layout.mjs';

const ZH = {
  communityTitle: 'AI Coding 项目交流群',
  communityText: '交流 Claude Code / Codex 配置、额度使用和站点动态，分享 AI 编程实践与项目体验。',
  communityGroup: 'QQ 群号',
  communityJoin: '加入 QQ 群',
  communityQr: '入群二维码',
  communityHint: 'QQ 搜索群号，或扫码加入',
};

/** The group belongs to this directory, separate from the listed providers. */
export function communityReadme(meta, copy = ZH) {
  const group = meta.community;
  if (!group) return [];
  return [
    '> [!TIP]',
    `> **💬 ${esc(copy.communityTitle)} · ${esc(copy.communityGroup)}：${esc(group.qqGroup)}**`,
    '>',
    `> ${esc(copy.communityText)}`,
    '>',
    `> **[${esc(copy.communityJoin)} →](${group.joinUrl})** · [${esc(copy.communityQr)}](docs/${group.qrPath})`,
    '',
  ];
}

export function communityBanner(meta, copy = ZH, base = '') {
  const group = meta.community;
  if (!group) return '';
  const qrAlt = `${copy.communityQr} · ${group.qqGroup}`;
  return `<aside class="community-banner" aria-label="${esc(copy.communityTitle)}">
      <div class="community-copy">
        <p class="community-title">💬 ${esc(copy.communityTitle)}</p>
        <p class="community-description">${esc(copy.communityText)}</p>
        <p class="community-group">${esc(copy.communityGroup)} <strong>${esc(group.qqGroup)}</strong></p>
        <div class="community-actions">
          <a class="btn community-join" href="${esc(group.joinUrl)}" target="_blank" rel="noopener noreferrer">${esc(copy.communityJoin)} ↗</a>
          <span>${esc(copy.communityHint)}</span>
        </div>
      </div>
      <a class="community-qr" href="${esc(`${base}${group.qrPath}`)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(qrAlt)}">
        <img src="${esc(`${base}${group.qrPath}`)}" width="128" height="128" alt="${esc(qrAlt)}">
      </a>
    </aside>`;
}
