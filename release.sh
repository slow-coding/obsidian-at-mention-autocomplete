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

# 1. 隐私检查
echo "==> 隐私检查..."
if grep -riE "token|secret|password|api[_-]?key|ghp_|gho_|github_pat" . --exclude-dir=node_modules | grep -v "release.sh"; then
  echo "❌ 发现疑似敏感信息，终止！"
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
