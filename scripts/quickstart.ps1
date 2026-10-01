# 交互式为 Claude Code 配置福利站接入参数（Windows PowerShell）。
# 用法： powershell -ExecutionPolicy Bypass -File scripts/quickstart.ps1
#        加 -Persist 会写入用户级环境变量（新开终端也生效）。
#
# 本文件必须保存为「UTF-8 with BOM」：Windows 自带的 PowerShell 5.1 读到没有 BOM 的脚本，
# 会按系统代码页（中文系统是 GBK）解析，中文提示全变乱码，严重时报「字符串缺少终止符」。
param([switch]$Persist)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sitesFile = Join-Path $root 'data\sites.json'
$liveFile = Join-Path $root 'data\live.json'

if (-not (Test-Path $sitesFile)) { throw "找不到 $sitesFile" }

# @() 保证只剩一个站时也是数组，.Count 和下标才靠得住
$sites = @((Get-Content $sitesFile -Raw -Encoding UTF8 | ConvertFrom-Json).sites |
  Where-Object { $_.endpoints.anthropic -and -not $_.archived })
$live = if (Test-Path $liveFile) { (Get-Content $liveFile -Raw -Encoding UTF8 | ConvertFrom-Json).sites } else { @() }

Write-Host "`n可选站点（只列出提供 Anthropic 兼容 Base URL、能直连 Claude Code 的站点）：" -ForegroundColor Cyan
for ($i = 0; $i -lt $sites.Count; $i++) {
  Write-Host ("  {0}) {1} — {2}" -f ($i + 1), $sites[$i].name, $sites[$i].subtitle)
}

$idx = Read-Host "`n选择站点编号 [1]"
if ([string]::IsNullOrWhiteSpace($idx)) { $idx = '1' }
# 先校验范围：PowerShell 的负下标从末尾取，输 0 会静默选中最后一个站
$n = 0
if (-not [int]::TryParse($idx.Trim(), [ref]$n) -or $n -lt 1 -or $n -gt $sites.Count) { throw '编号无效' }
$site = $sites[$n - 1]

$snap = $live | Where-Object { $_.id -eq $site.id }
$model = $snap.defaults.claude
if (-not $model) { $model = 'claude-opus-4-8' }

Write-Host "`n站点：$($site.name)" -ForegroundColor Green
Write-Host "还没有账号？先注册领额度：$($site.signupUrl)" -ForegroundColor Yellow

$secure = Read-Host "`n粘贴该站后台创建的 API Key" -AsSecureString
# BSTR 是 UTF-16，用 PtrToStringBSTR 读；用完立刻清零，明文 Key 不在内存里多留
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ([string]::IsNullOrWhiteSpace($key)) { throw 'Key 不能为空' }

$inputModel = Read-Host "模型名 [$model]"
if (-not [string]::IsNullOrWhiteSpace($inputModel)) { $model = $inputModel.Trim() }

$base = $site.endpoints.anthropic
$env:ANTHROPIC_BASE_URL = $base
$env:ANTHROPIC_AUTH_TOKEN = $key
$env:ANTHROPIC_MODEL = $model

Write-Host "`n当前会话已设置：" -ForegroundColor Cyan
Write-Host "  ANTHROPIC_BASE_URL  = $base"
Write-Host "  ANTHROPIC_MODEL     = $model"
Write-Host "  ANTHROPIC_AUTH_TOKEN= (已设置，未回显)"

if ($Persist) {
  [Environment]::SetEnvironmentVariable('ANTHROPIC_BASE_URL', $base, 'User')
  [Environment]::SetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN', $key, 'User')
  [Environment]::SetEnvironmentVariable('ANTHROPIC_MODEL', $model, 'User')
  Write-Host "`n已写入用户级环境变量，新开的终端也会生效。" -ForegroundColor Green
} else {
  Write-Host "`n只在当前会话生效；想永久保存请加 -Persist 重跑。" -ForegroundColor DarkGray
}

Write-Host "`n接下来："
Write-Host "  npm install -g @anthropic-ai/claude-code@latest"
Write-Host "  claude"
