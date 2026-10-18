// test/helpers/links.js — 造**符号链接**的夹具。能不能造取决于平台：Windows 上 `fs.symlinkSync` 要
// `SeCreateSymbolicLinkPrivilege`（开发者模式或管理员），普通用户拿到的是 `EPERM`。
//
// 这一批用例考的是**「链接不被跟随」**这条安全规则（`server/studio/files.js`、`server/plugins/install.js`、
// `server/plugins/forgeImport.js`、`server/plugins/pack.js` 都走 `lstat().isSymbolicLink()`）。所以既不希望
// 它们因为平台限制整条消失（那样 Windows 上这条规则就没测过），也不希望为了跑通而放宽断言。
//
// **目录**链接有出口：Windows 的 **junction** 同样是重解析点 —— Node 的 `lstatSync().isSymbolicLink()` 对它
// 判真、`readlinkSync` 也读得出目标（实测），而且不需要特权、目标不存在也建得出来。于是 `linkDir` 在
// `EPERM` 时退回 junction，**断言一字不改**，两个平台都真的跑到。
// **文件**链接没有出口（junction 只能指目录；硬链接不是重解析点、`isSymbolicLink()` 判假，语义完全不同），
// 所以 `linkFile` 在平台拒绝时返回 `false`，由调用方决定 —— 既有纪律是 `t.skip` 并写明平台限制
// （见 `test/asset-index.test.js:54-63` 的同一组错误码与同一句话）。

import fs from 'node:fs';

/** 「这个平台不能建链接」的错误码（与 `test/asset-index.test.js` 同一组）。 */
export const LINK_UNSUPPORTED = ['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'];

/**
 * 建一条**目录**链接：平台允许时是真符号链接，否则退回 junction（对 `isSymbolicLink()` 同判）。
 * @param {string} target 目标目录
 * @param {string} path 链接自身的位置
 */
export function linkDir(target, path) {
  try {
    fs.symlinkSync(target, path, 'dir');
  } catch (e) {
    if (!LINK_UNSUPPORTED.includes(e.code)) throw e;
    fs.symlinkSync(target, path, 'junction');
  }
}

/**
 * 建一条**文件**链接：平台拒绝时返回 `false`（没有语义等价的替代物）。
 * @param {string} target 目标文件
 * @param {string} path 链接自身的位置
 * @returns {boolean} 建成功了吗
 */
export function linkFile(target, path) {
  try {
    fs.symlinkSync(target, path);
    return true;
  } catch (e) {
    if (!LINK_UNSUPPORTED.includes(e.code)) throw e;
    return false;
  }
}
