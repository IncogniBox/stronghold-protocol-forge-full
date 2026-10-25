// 联邦（单节点版）：本仓库只有一台服务器，但房间目录走的是同一条 `room.list` 通道 ——
// 大厅在大厅屏每 10 秒拉一次，房间邀请链接附带本节点 id。`enabled = true` 让大厅走「目录」这条路，
// 而不是只信一个本地静态列表；多台服务器互相注册的那个目录服务不在本仓库内。
//
// 节点 id 只用于邀请链接上的 `&node=`（本服务器不解析它）：固定 `local` 就够了，且不会随刷新变化。

/** Whether this page belongs to a federated directory. */
export const enabled = true;

/** This page's node id in the directory (single-node deployment). */
export function currentNode() { return 'local'; }
