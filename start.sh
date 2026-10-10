#!/bin/bash
# 卫戍协议：盟约 —— 服务器启动脚本（拉取自己的完整工坊包仓库）
#
# 与原版的区别：
#   1) 拉取源改为 IncogniBox/stronghold-protocol-forge-full（完整包，已内置 mod 与素材）
#   2) 该仓库根目录是安装包结构，游戏本体在 app/ 子目录 → 统一走 GAME_DIR="$DIR/app"
#   3) 分支由 master 改为 main
#   4) 存档备份路径 data/ → app/data/
#   5) 依赖与素材已随仓库自带，正常情况下不再下载；缺失时才回退到 yarn install / setup.mjs
cd /home/container

# 环境预检
command -v git > /dev/null 2>&1 || { apt update && apt install git -y; }

# 强力清理旧进程，防止锁文件占用
pkill -9 node || true
sleep 1

# ── 代码源 ────────────────────────────────────────────────────────────────────
REPO_URL="https://github.com/IncogniBox/stronghold-protocol-forge-full.git"
DIR="Stronghold-Protocol"
GAME_DIR="$DIR/app"          # 游戏本体所在子目录（server/、public/、tools/、data/ 都在这一层）

NEED_UPDATE=false

# 若之前克隆的是别的仓库（根目录没有 app/），先清掉，避免结构不一致
if [ -d "$DIR" ] && [ ! -d "$GAME_DIR" ]; then
    echo "检测到旧仓库结构，重新克隆..."
    rm -rf "$DIR"
fi

# 拉取或更新代码
if [ ! -d "$DIR" ]; then
    echo "首次拉取代码（完整包约 700MB，请耐心等待）..."
    git clone "$REPO_URL" "$DIR"
    NEED_UPDATE=true
else
    echo "检查更新..."
    cd "$DIR"
    git remote set-url origin "$REPO_URL"
    git fetch --all
    if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
        echo "发现更新，备份存档并拉取..."
        [ -d "app/data" ] && rm -rf /home/container/backup_data && cp -a app/data /home/container/backup_data
        git reset --hard origin/main
        [ -d "/home/container/backup_data" ] && rm -rf app/data && cp -a /home/container/backup_data app/data
        NEED_UPDATE=true
    fi
    cd ..
fi

cd "$GAME_DIR"

# 配置 Yarn
echo "nodeLinker: node-modules" > .yarnrc.yml
echo "enableScripts: false" >> .yarnrc.yml

# 依赖与素材：完整包已自带 node_modules 与 public/assets，正常无需下载
if [ ! -d "node_modules" ]; then
    echo "安装依赖..."
    mise exec node@22.14.0 yarn@4.9.1 -- yarn install
fi
if [ ! -d "public/assets" ] || [ -z "$(ls -A public/assets 2>/dev/null)" ]; then
    echo "下载美术资源（首次较慢，请耐心等待）..."
    mise exec node@22.14.0 -- node tools/setup.mjs --quiet -y
fi

# 清理锁文件并启动
rm -rf .state 2>/dev/null
rm -f data/*.lock data/*.tmp 2>/dev/null
PORT=${PORT:-3000}
echo "启动服务器，端口：${PORT}..."
PORT=${PORT} mise exec node@22.14.0 -- node server/index.js
