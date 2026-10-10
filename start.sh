#!/bin/bash
# 卫戍协议：盟约 —— 服务器启动脚本（拉取自己的完整工坊包仓库）
#
# 与原版的区别：
#   1) 拉取源改为 IncogniBox/stronghold-protocol-forge-full（完整包，已内置 mod 与素材）
#   2) 该仓库根目录是安装包结构，游戏本体在 app/ 子目录 → 统一走 GAME_DIR="$DIR/app"
#   3) 分支由 master 改为 main
#   4) 存档备份路径 data/ → app/data/
#   5) 依赖与素材已随仓库自带，正常情况下不再下载；缺失时才回退到 yarn install / setup.mjs
#   6) 拉取统一强制 HTTP/1.1，并带「直连重试 → 镜像回退」，任何一步失败即停止（不再带着空目录往下跑）
cd /home/container

# 环境预检
command -v git > /dev/null 2>&1 || { apt update && apt install git -y; }

# 强力清理旧进程，防止锁文件占用
pkill -9 node || true
sleep 1

# ── 代码源 ────────────────────────────────────────────────────────────────────
REPO_URL="https://github.com/IncogniBox/stronghold-protocol-forge-full.git"
# 镜像前缀：直连 GitHub 不顺时自动回退使用。设为空字符串可禁用（面板环境变量 SP_GITHUB_PROXY=）
MIRROR_PREFIX="${SP_GITHUB_PROXY-https://gh-proxy.com/}"
DIR="Stronghold-Protocol"
GAME_DIR="$DIR/app"          # 游戏本体所在子目录（server/、public/、tools/、data/ 都在这一层）

# 拉 700MB 大包时强制 HTTP/1.1：境内常见的 "HTTP/2 stream ... CANCEL / 过早的文件结束符" 靠这个规避
git_big() { git -c http.version=HTTP/1.1 "$@"; }

# 以指定地址克隆，最多试 3 次（每次先清干净，避免半个仓库）
clone_try() {
    local name="$1" url="$2" i
    for i in 1 2 3; do
        rm -rf "$DIR"
        echo "克隆代码（${name}，第 ${i}/3 次）：${url}"
        if git_big clone "$url" "$DIR"; then return 0; fi
        echo "  本次失败，清理后重试..."
        rm -rf "$DIR"
        sleep 3
    done
    return 1
}

# 不完整或旧结构的仓库（缺 server/index.js）直接清掉重建
if [ -d "$DIR" ] && [ ! -f "$GAME_DIR/server/index.js" ]; then
    echo "检测到不完整或旧结构的仓库，重新克隆..."
    rm -rf "$DIR"
fi

# 拉取或更新代码
if [ ! -d "$DIR" ]; then
    echo "首次拉取代码（完整包约 700MB，请耐心等待）..."
    if ! clone_try "直连" "$REPO_URL"; then
        if [ -n "$MIRROR_PREFIX" ]; then
            echo "直连失败，改用镜像 ${MIRROR_PREFIX} ..."
            clone_try "镜像" "${MIRROR_PREFIX}${REPO_URL}" || {
                echo "代码拉取失败：请检查容器到 GitHub 的网络，或在面板设置环境变量 SP_GITHUB_PROXY 后重试。"
                exit 1
            }
        else
            echo "代码拉取失败：请检查容器到 GitHub 的网络。"
            exit 1
        fi
    fi
else
    echo "检查更新..."
    cd "$DIR" || { echo "进入 ${DIR} 失败"; exit 1; }
    git remote set-url origin "$REPO_URL"
    if ! git_big fetch origin main; then
        if [ -n "$MIRROR_PREFIX" ]; then
            echo "直连检查更新失败，改用镜像..."
            git remote set-url origin "${MIRROR_PREFIX}${REPO_URL}"
            git_big fetch origin main
        fi
    fi
    if git rev-parse --verify -q origin/main > /dev/null && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
        echo "发现更新，备份存档并拉取..."
        [ -d "app/data" ] && rm -rf /home/container/backup_data && cp -a app/data /home/container/backup_data
        git_big reset --hard origin/main
        [ -d "/home/container/backup_data" ] && rm -rf app/data && cp -a /home/container/backup_data app/data
    else
        echo "已是最新。"
    fi
    cd ..
fi

cd "$GAME_DIR" || { echo "目录结构异常：找不到 ${GAME_DIR}"; exit 1; }

# 配置 Yarn
echo "nodeLinker: node-modules" > .yarnrc.yml
echo "enableScripts: false" >> .yarnrc.yml

# 依赖与素材：完整包已自带 node_modules 与 public/assets，正常无需下载
if [ ! -d "node_modules" ]; then
    echo "安装依赖..."
    mise exec node@22.14.0 yarn@4.9.1 -- yarn install || { echo "依赖安装失败"; exit 1; }
fi
if [ ! -d "public/assets" ] || [ -z "$(ls -A public/assets 2>/dev/null)" ]; then
    echo "下载美术资源（首次较慢，请耐心等待）..."
    SP_GITHUB_PROXY="$MIRROR_PREFIX" mise exec node@22.14.0 -- node tools/setup.mjs --quiet -y
fi

# 清理锁文件并启动
rm -rf .state 2>/dev/null
rm -f data/*.lock data/*.tmp 2>/dev/null
PORT=${PORT:-3000}
echo "启动服务器，端口：${PORT}..."
PORT=${PORT} mise exec node@22.14.0 -- node server/index.js
