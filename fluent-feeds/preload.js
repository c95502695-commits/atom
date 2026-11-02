'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

const on = (channel, cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  listFeeds: () => invoke('feeds:list'),
  addFeed: url => invoke('feeds:add', url),
  removeFeed: id => invoke('feeds:remove', id),
  renameFeed: (id, title) => invoke('feeds:rename', id, title),
  refresh: () => invoke('feeds:refresh'),
  listItems: opts => invoke('items:list', opts),
  getItem: id => invoke('items:get', id),
  setItemState: (id, patch) => invoke('items:state', id, patch),
  markAllRead: opts => invoke('items:markAllRead', opts),
  counts: () => invoke('counts'),
  openExternal: url => invoke('open-external', url),
  isDark: () => invoke('theme:get'),
  importOpml: () => invoke('opml:import'),
  exportOpml: () => invoke('opml:export'),
  onDataChanged: cb => on('data-changed', cb),
  onRefreshState: cb => on('refresh-state', cb),
  onMenu: cb => on('menu', cb)
});
