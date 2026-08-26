#!/bin/bash
# Mention Autocomplete 发版脚本
# 杜绝两类反复事故：tag 带 v 前缀、漏传 assets
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: ./release.sh X.Y.Z"
  echo "Example: ./release.sh 1.0.10"
  exit 1
fi

VERSION="$1"
TAG="$VERSION"  # 不加 v，社区插件规则
REPO="slow-coding/obsidian-at-mention-autocomplete"

# 1. 隐私检查（🚨 红线 Darren 2026-08-26 定调：不可绕过，覆盖 凭证key/pwd + 本地路径 + 名字/公司）
echo "==> 隐私检查..."
# 1a. 凭证类：token/secret/password/key 全形态 + 私钥 + 知名服务 key 模式 + 连接串 + 中文
if grep -rniIE "ghp_|gho_|github_pat|api[_-]?key|secret[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|api[_-]?secret|password|passwd|\\bpwd|credential|bearer |authorization:|BEGIN ([A-Z ]*)?PRIVATE KEY|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{16,}|(mongodb|mongo)(\\+srv)?://[^ ]+:[^ ]+@|jwt\\b|密钥|密码|口令|令牌|访问密钥" . --exclude-dir=node_modules --exclude-dir=.git | grep -v "release.sh"; then
  echo "❌ 发现疑似敏感信息（凭证），终止！"
  exit 1
fi
# 1b. 凭证文件形态：.env / 私钥密钥文件 / 凭证文件
if find . -path ./node_modules -prune -o -path ./.git -prune -o -type f \( -name ".env*" -o -name "*.pem" -o -name "*.key" -o -name "id_rsa*" -o -name "*credential*" -o -name "*secret*" \) -print | grep -v "release.sh" | grep -q .; then
  echo "❌ 发现疑似凭证文件（.env/pem/key 等），终止！"
  exit 1
fi
# 1c. 本地路径 / 机器信息 / 公司与内部项目名
if grep -rniIE "/Users/|/home/|/Library/|iCloud~|\\\\~/code|darrenzheng|darren_zheng|金蝶|Kingdee|kingdee|yzj_ai|192\\.168\\.|10\\.0\\.|172\\.1[6-9]\\." . --exclude-dir=node_modules --exclude-dir=.git | grep -v "release.sh"; then
  echo "❌ 发现疑似本地路径/环境/公司信息，终止！"
  exit 1
fi
# 1d. 个人信息：邮箱 / 电话 / 身份证号 / 地址
if grep -rnoIE "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+|1[3-9][0-9]{9}|[0-9]{17}[0-9Xx]|身份证|手机号" . --exclude-dir=node_modules --exclude-dir=.git | grep -v "release.sh"; then
  echo "❌ 发现疑似个人信息（邮箱/电话/身份证），终止！"
  exit 1
fi
echo "✅ 通过"

# 2. 确认 manifest 版本
MANIFEST_VER=$(grep '"version"' manifest.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
if [ "$MANIFEST_VER" != "$VERSION" ]; then
  echo "❌ manifest.json 版本是 $MANIFEST_VER，但你要发 $VERSION。先更新 manifest.json！"
  exit 1
fi
echo "✅ manifest.json 版本: $VERSION"

# 3. 确认 tag 不存在
if git tag -l | grep -Fx "$TAG" > /dev/null; then
  echo "❌ tag $TAG 已存在"
  exit 1
fi
if git ls-remote --tags origin | grep -F "refs/tags/$TAG" > /dev/null 2>&1; then
  echo "❌ remote tag $TAG 已存在"
  exit 1
fi
echo "✅ tag $TAG 可用"

# 4. 确认三个 asset 文件存在
for f in main.js manifest.json styles.css; do
  if [ ! -f "$f" ]; then
    echo "❌ 缺少文件: $f"
    exit 1
  fi
done
echo "✅ assets: main.js manifest.json styles.css"

# 5. 提交 + 推送
echo ""
echo "==> 提交并推送..."
git add main.js manifest.json styles.css main.ts 2>/dev/null || true
if git diff --cached --quiet; then
  echo "⚠️  没有待提交的改动，跳过 commit"
else
  git commit -m "$VERSION"
fi
git push origin main

# 6. 打 tag + 推送
git tag "$TAG"
git push origin "$TAG"

# 7. 创建 GitHub Release（带 assets）
echo ""
echo "==> 创建 GitHub Release..."
gh release create "$TAG" main.js manifest.json styles.css \
  --repo "$REPO" \
  --title "$VERSION" \
  --notes "## Changelog" \
  --verify-tag

# 8. 验证
echo ""
echo "==> 验证 release..."
gh release view "$TAG" --repo "$REPO"

echo ""
echo "✅ $VERSION 发版完成"
echo "   确认 assets 都在上面输出中"
