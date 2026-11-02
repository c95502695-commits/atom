'use strict';

const { parseFeed, discoverFeedUrls } = require('./feed-parser');

const MAX_BYTES = 8 * 1024 * 1024;

/** Download a URL as text with timeout and size limit (http/https only). */
async function fetchText(url, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported');
  }
  const res = await fetchImpl(u.toString(), {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'FluentFeeds/1.0 (+RSS reader)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5'
    }
  });
  if (!res.ok) throw new Error(`Server responded with ${res.status} ${res.statusText}`.trim());
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error('Feed is too large');
  return { text: body, url: res.url || u.toString() };
}

/** Turn user input ("example.com", "feed://…") into an absolute http(s) URL. */
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter a feed or website address');
  s = s.replace(/^feed:\/\//i, 'https://').replace(/^feed:/i, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('That does not look like a valid address');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https addresses are supported');
  }
  return u.toString();
}

class FeedService {
  /**
   * @param {import('./store').Store} store
   * @param {{fetchText?: typeof fetchText}} [opts]
   */
  constructor(store, { fetchText: fetcher = fetchText } = {}) {
    this.store = store;
    this.fetchText = fetcher;
    this.refreshing = null;
  }

  /** Subscribe to a feed URL, or to the first feed advertised by a web page. */
  async addFeed(input) {
    const url = normalizeUrl(input);
    const first = await this.fetchText(url);
    let feedUrl = first.url;
    let parsed;
    try {
      parsed = parseFeed(first.text, feedUrl);
    } catch (e) {
      const candidates = discoverFeedUrls(first.text, first.url);
      if (!candidates.length) throw new Error('No RSS or Atom feed was found at that address');
      const second = await this.fetchText(candidates[0]);
      feedUrl = second.url;
      parsed = parseFeed(second.text, feedUrl);
    }
    const feed = this.store.addFeed({ url: feedUrl, title: parsed.title, siteUrl: parsed.siteUrl });
    this.store.mergeItems(feed.id, parsed.items);
    this.store.updateFeed(feed.id, { lastFetched: new Date().toISOString() });
    return this.store.getFeed(feed.id);
  }

  async refreshFeed(id) {
    const feed = this.store.getFeed(id);
    if (!feed) return { added: 0, error: 'Unknown feed' };
    try {
      const { text, url } = await this.fetchText(feed.url);
      const parsed = parseFeed(text, url);
      const added = this.store.mergeItems(id, parsed.items);
      this.store.updateFeed(id, {
        title: parsed.title || feed.title,
        siteUrl: parsed.siteUrl || feed.siteUrl,
        lastFetched: new Date().toISOString(),
        error: null
      });
      return { added };
    } catch (e) {
      this.store.updateFeed(id, { lastFetched: new Date().toISOString(), error: e.message });
      return { added: 0, error: e.message };
    }
  }

  /** Refresh all feeds with limited concurrency. Concurrent calls share one run. */
  refreshAll({ concurrency = 4 } = {}) {
    if (this.refreshing) return this.refreshing;
    const ids = this.store.data.feeds.map(f => f.id);
    let next = 0;
    let added = 0;
    const worker = async () => {
      while (next < ids.length) {
        const r = await this.refreshFeed(ids[next++]);
        added += r.added;
      }
    };
    this.refreshing = Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
      .then(() => ({ added }))
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Add OPML subscriptions without fetching; returns {added, skipped}. */
  importSubscriptions(subs) {
    let added = 0;
    let skipped = 0;
    for (const s of subs) {
      let url;
      try {
        url = normalizeUrl(s.url);
      } catch {
        skipped++;
        continue;
      }
      try {
        this.store.addFeed({ url, title: s.title, siteUrl: s.siteUrl });
        added++;
      } catch {
        skipped++;
      }
    }
    return { added, skipped };
  }
}

module.exports = { FeedService, fetchText, normalizeUrl };
