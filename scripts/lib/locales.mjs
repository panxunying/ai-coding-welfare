/** Locale routing only. Copy lives in data/locales/*.json; URLs and credits stay in sites.json. */
// og is the Open Graph locale (language_TERRITORY), which uses an underscore rather than BCP 47's hyphen.
export const LANGUAGES = [
  { id: 'zh-CN', label: '简体中文', path: '', readme: 'README.md', og: 'zh_CN' },
  { id: 'en', label: 'English', path: 'en/', readme: 'README.en.md', og: 'en_US' },
  { id: 'hi', label: 'हिन्दी', path: 'hi/', readme: 'README.hi.md', og: 'hi_IN' },
  { id: 'pt-BR', label: 'Português (Brasil)', path: 'pt-BR/', readme: 'README.pt-BR.md', og: 'pt_BR' },
  { id: 'ja', label: '日本語', path: 'ja/', readme: 'README.ja.md', og: 'ja_JP' },
  { id: 'de', label: 'Deutsch', path: 'de/', readme: 'README.de.md', og: 'de_DE' },
];
export const TRANSLATED_LANGUAGES = LANGUAGES.filter((l) => l.id !== 'zh-CN');
export function language(id) {
  const result = LANGUAGES.find((l) => l.id === id);
  if (!result) throw new Error(`Unsupported locale: ${id}`);
  return result;
}

// Small local escaper avoids a layout ↔ locales dependency cycle.
const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function languageNav({ locale = 'zh-CN', base = '', path = '', label = '语言 / Language' } = {}) {
  return `<nav class="languages" aria-label="${attr(label)}">${LANGUAGES.map((l) =>
    `<a href="${attr(base + l.path + path)}" lang="${l.id}" hreflang="${l.id}"${l.id === locale ? ' aria-current="page"' : ''}>${l.label}</a>`,
  ).join('')}</nav>`;
}
export function languageAlternates(pagesUrl, path) {
  const base = (pagesUrl ?? '').replace(/\/?$/, '/');
  return [...LANGUAGES.map((l) => `<link rel="alternate" hreflang="${l.id}" href="${attr(base + l.path + path)}">`),
    `<link rel="alternate" hreflang="x-default" href="${attr(base + path)}">`].join('\n');
}
export function readmeLanguages(locale = 'zh-CN') {
  return LANGUAGES.map((l) => l.id === locale ? `**${l.label}**` : `[${l.label}](${l.readme})`).join(' · ');
}
