#!/usr/bin/env bash
# 交互式为 Claude Code 配置福利站接入参数（macOS / Linux）。
# 用法： bash scripts/quickstart.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITES="$ROOT/data/sites.json"
LIVE="$ROOT/data/live.json"

command -v node >/dev/null 2>&1 || { echo "需要 Node.js 18+，请先安装：https://nodejs.org"; exit 1; }
[ -f "$SITES" ] || { echo "找不到 $SITES"; exit 1; }

echo "可选站点（只列出提供 Anthropic 兼容 Base URL、能直连 Claude Code 的站点）："
node -e '
const fs=require("fs");
const {sites}=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
sites.filter(s=>s.endpoints&&s.endpoints.anthropic&&!s.archived).forEach((s,i)=>console.log(`  ${i+1}) ${s.name} — ${s.subtitle}`));
' "$SITES"

read -r -p "选择站点编号 [1]: " IDX
IDX="${IDX:-1}"

# 一行一个字段：站名里可能有空格（「KKtoken AI」），以前拼成一行再按空格拆，
# Base URL 会被拆成「AI」写进 rc 文件，Claude Code 直接连不上
CFG="$(node -e '
const fs=require("fs");
const {sites}=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
let live={sites:[]}; try{live=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));}catch{}
const list=sites.filter(s=>s.endpoints&&s.endpoints.anthropic&&!s.archived);
const s=list[Number(process.argv[3])-1];
if(!s){console.error("编号无效");process.exit(1);}
const snap=(live.sites||[]).find(x=>x.id===s.id);
const model=snap?.defaults?.claude || "claude-opus-4-8";
process.stdout.write([s.name,s.endpoints.anthropic,model,s.signupUrl].join("\n"));
' "$SITES" "$LIVE" "$IDX")"
{ IFS= read -r NAME; IFS= read -r BASE; IFS= read -r MODEL; IFS= read -r SIGNUP; } <<< "$CFG"

# 写进 rc 的值放在双引号里，带 " $ ` \ 的值每次开终端都会被当成代码执行；
# 正常的 Key 与模型名没有这些字符（也没有空白），出现了多半是复制时带进了别的东西
unsafe() { case "$1" in *[\"\$\`\\[:space:]]*) return 0 ;; *) return 1 ;; esac; }

echo
echo "站点：$NAME"
echo "还没有账号？先注册领额度：$SIGNUP"
echo
read -r -s -p "粘贴该站后台创建的 API Key: " KEY; echo
[ -n "$KEY" ] || { echo "Key 不能为空"; exit 1; }
if unsafe "$KEY"; then echo "Key 里有空格、引号、\$ 或反斜杠，多半复制错了，请重新复制"; exit 1; fi

read -r -p "模型名 [$MODEL]: " M; MODEL="${M:-$MODEL}"
if unsafe "$MODEL"; then echo "模型名里不能有空格、引号、\$ 或反斜杠"; exit 1; fi

# 配置块按同一个模板渲染两份：一份写文件，一份给屏幕看（Key 打码），
# 不用字符串替换去「抹掉」Key——Key 里的字符会被当成匹配模式
snippet() {
  printf '\n# >>> ai-coding-welfare: %s >>>\nexport ANTHROPIC_BASE_URL="%s"\nexport ANTHROPIC_AUTH_TOKEN="%s"\nexport ANTHROPIC_MODEL="%s"\n# <<< ai-coding-welfare: %s <<<' \
    "$NAME" "$BASE" "$1" "$MODEL" "$NAME"
}
# 屏幕上只显示打码后的 Key，避免 Key 出现在终端回滚缓冲区里
MASK="${KEY:0:4}****${KEY: -4}"

case "${SHELL:-}" in
  */zsh) RC="$HOME/.zshrc" ;;
  */fish) RC="" ;;
  *) RC="$HOME/.bashrc" ;;
esac

echo
echo "将写入以下配置（Key 已打码显示）："
snippet "$MASK"; echo
echo
if [ -n "$RC" ]; then
  read -r -p "写入 $RC ？之前由本脚本写入的配置会被替换 [y/N] " OK
  if [[ "${OK:-N}" =~ ^[Yy]$ ]]; then
    if [ -f "$RC" ] && grep -q '^# >>> ai-coding-welfare' "$RC"; then
      # 只删本脚本自己写的标记块（连同它前面那一行空行）：换站重跑不会叠出好几份，
      # 旧 Key 也不会继续明文留在 rc 里。缺了结束标记的块原样保留，宁可多一份也不误删用户自己的配置；
      # 用 > 回写而不是 mv，rc 是指向 dotfiles 仓库的软链时不会被换成普通文件
      cp "$RC" "$RC.ai-coding-welfare.bak"
      awk '
        /^# >>> ai-coding-welfare/ { if (inblk) printf "%s", buf; buf = held $0 ORS; held = ""; inblk = 1; next }
        inblk && /^# <<< ai-coding-welfare/ { inblk = 0; buf = ""; next }
        inblk { buf = buf $0 ORS; next }
        /^$/ { printf "%s", held; held = $0 ORS; next }
        { printf "%s", held; held = ""; print }
        END { printf "%s", held; if (inblk) printf "%s", buf }
      ' "$RC.ai-coding-welfare.bak" > "$RC"
      echo "已替换之前写入的配置，原文件备份在 $RC.ai-coding-welfare.bak（里面有旧 Key，确认无误后可删除）"
    fi
    snippet "$KEY" >> "$RC"; echo >> "$RC"
    # 变量后紧跟全角标点必须写成 ${RC}：macOS 自带的 bash 3.2 在 UTF-8 locale 下会把「，」的首字节
    # 当成变量名的一部分（RC\xef），配合 set -u 直接报 unbound variable——配置写进去了，脚本却崩在这句提示上
    echo "已写入 ${RC}，执行 source ${RC} 生效。"
  else
    echo "已跳过写入，可自行复制上面的内容。"
  fi
else
  echo "检测到 fish shell，请手动用 set -gx 设置以上三个变量。"
fi

echo
echo "本次会话立即生效："
echo "  export ANTHROPIC_BASE_URL=\"$BASE\" ANTHROPIC_AUTH_TOKEN=\"<你的Key>\" ANTHROPIC_MODEL=\"$MODEL\""
echo "然后运行： claude"
