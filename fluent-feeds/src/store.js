'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ITEMS_PER_FEED = 300;

/** Small JSON-file persistence layer for feeds and articles. */
class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { feeds: [], items: {} };
    this.load();
  }

  load() {
    if (!this.filePath) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = { feeds: parsed.feeds || [], items: parsed.items || {} };
    } catch {
      // Missing or corrupt file: start empty.
    }
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  // ---- feeds -------------------------------------------------------------

  getFeed(id) {
    return this.data.feeds.find(f => f.id === id) || null;
  }

  addFeed({ url, title = '', siteUrl = '' }) {
    if (this.data.feeds.some(f => f.url === url)) {
      throw new Error('You are already subscribed to this feed');
    }
    const feed = {
      id: crypto.createHash('sha1').update(url).digest('hex').slice(0, 12),
      url,
      title: title || url,
      siteUrl,
      addedAt: new Date().toISOString(),
      lastFetched: null,
      error: null
    };
    this.data.feeds.push(feed);
    this.save();
    return feed;
  }

  updateFeed(id, patch) {
    const feed = this.getFeed(id);
    if (!feed) return null;
    Object.assign(feed, patch);
    this.save();
    return feed;
  }

  removeFeed(id) {
    this.data.feeds = this.data.feeds.filter(f => f.id !== id);
    for (const [key, item] of Object.entries(this.data.items)) {
      if (item.feedId === id) delete this.data.items[key];
    }
    this.save();
  }

  listFeeds() {
    const unread = {};
    for (const item of Object.values(this.data.items)) {
      if (!item.read) unread[item.feedId] = (unread[item.feedId] || 0) + 1;
    }
    return this.data.feeds
      .map(f => ({ ...f, unread: unread[f.id] || 0 }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }

  counts() {
    let unread = 0;
    let starred = 0;
    let total = 0;
    for (const item of Object.values(this.data.items)) {
      total++;
      if (!item.read) unread++;
      if (item.starred) starred++;
    }
    return { total, unread, starred };
  }

  // ---- items -------------------------------------------------------------

  /** Merge freshly parsed items; keeps read/starred state. Returns number of new items. */
  mergeItems(feedId, parsedItems) {
    let added = 0;
    const fetchedAt = new Date().toISOString();
    for (const p of parsedItems) {
      const key = `${feedId}:${p.id}`;
      const existing = this.data.items[key];
      if (existing) {
        Object.assign(existing, {
          title: p.title,
          link: p.link,
          author: p.author,
          summary: p.summary,
          content: p.content,
          image: p.image,
          published: p.published || existing.published
        });
      } else {
        this.data.items[key] = {
          ...p,
          id: key,
          feedId,
          fetchedAt,
          read: false,
          starred: false
        };
        added++;
      }
    }
    this.prune(feedId);
    this.save();
    return added;
  }

  prune(feedId) {
    const mine = Object.values(this.data.items)
      .filter(i => i.feedId === feedId && !i.starred)
      .sort((a, b) => this.sortKey(b).localeCompare(this.sortKey(a)));
    for (const old of mine.slice(MAX_ITEMS_PER_FEED)) delete this.data.items[old.id];
  }

  sortKey(item) {
    return item.published || item.fetchedAt || '';
  }

  /** List lightweight items (no full content). */
  listItems({ feedId = null, filter = 'all', query = '', limit = 500 } = {}) {
    const q = query.trim().toLowerCase();
    const feedTitles = Object.fromEntries(this.data.feeds.map(f => [f.id, f.title]));
    return Object.values(this.data.items)
      .filter(i => (!feedId || i.feedId === feedId))
      .filter(i => (filter === 'unread' ? !i.read : filter === 'starred' ? i.starred : true))
      .filter(
        i =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          (i.summary || '').toLowerCase().includes(q) ||
          (i.author || '').toLowerCase().includes(q)
      )
      .sort((a, b) => this.sortKey(b).localeCompare(this.sortKey(a)))
      .slice(0, limit)
      .map(({ content, ...rest }) => ({ ...rest, feedTitle: feedTitles[rest.feedId] || '' }));
  }

  getItem(id) {
    const item = this.data.items[id];
    if (!item) return null;
    const feed = this.getFeed(item.feedId);
    return { ...item, feedTitle: feed ? feed.title : '' };
  }

  setItemState(id, { read, starred }) {
    const item = this.data.items[id];
    if (!item) return null;
    if (typeof read === 'boolean') item.read = read;
    if (typeof starred === 'boolean') item.starred = starred;
    this.save();
    return item;
  }

  markAllRead({ feedId = null } = {}) {
    let n = 0;
    for (const item of Object.values(this.data.items)) {
      if ((!feedId || item.feedId === feedId) && !item.read) {
        item.read = true;
        n++;
      }
    }
    if (n) this.save();
    return n;
  }
}

module.exports = { Store, MAX_ITEMS_PER_FEED };
