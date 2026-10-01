<!-- 投稿新站点？先看 CONTRIBUTING.md「加一个新站点」。只想推荐、不想改代码的话，开 Issue 填表单更省事。 -->

- [ ] 只改了源文件：`data/sites.json`、`data/locales/*.json`（以及 `scripts/` 等手写文件）
- [ ] **没有**带上 `README*.md`、`docs/`、`data/live.json`：它们是生成物，CI 每 6 小时重写一次，带上几小时内就会冲突；合并后 CI 会自动探测并生成
- [ ] 新站点在五份 `data/locales/*.json` 里都补了译文
- [ ] 本地跑过 `npm test`
