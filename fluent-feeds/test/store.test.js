'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, MAX_ITEMS_PER_FEED } = require('../src/store');
const { FeedService, normalizeUrl } = require('../src/service');
const { parseOpml, buildOpml } = require('../src/opml');

const item = (n, extra = {}) => ({
  id: 'i' + n, title: 'Title ' + n, link: 'https://e/' + n, author: '', summary: 'sum ' + n,
  content: '<p>c</p>', image: '', published: new Date(2023, 0, n).toISOString(), ...extra
});

test('store persists and reloads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
  const file = path.join(dir, 'sub', 'lib.json');
  const s = new Store(file);
  const f = s.addFeed({ url: 'https://a/feed', title: 'A' });
  s.mergeItems(f.id, [item(1), item(2)]);
  const s2 = new Store(file);
  assert.equal(s2.listFeeds().length, 1);
  assert.equal(s2.listItems().length, 2);
  fs.rmSync(dir, { recursive: true });
});

test('store tolerates corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
  const file = path.join(dir, 'lib.json');
  fs.writeFileSync(file, '{not json');
  assert.equal(new Store(file).listFeeds().length, 0);
  fs.rmSync(dir, { recursive: true });
});

test('merge keeps read/starred state and counts only new items', () => {
  const s = new Store(null);
  const f = s.addFeed({ url: 'https://a/feed', title: 'A' });
  assert.equal(s.mergeItems(f.id, [item(1), item(2)]), 2);
  s.setItemState(`${f.id}:i1`, { read: true, starred: true });
  assert.equal(s.mergeItems(f.id, [item(1, { title: 'Renamed' }), item(3)]), 1);
  const got = s.getItem(`${f.id}:i1`);
  assert.equal(got.title, 'Renamed');
  assert.equal(got.read, true);
  assert.equal(got.starred, true);
  assert.deepEqual(s.counts(), { total: 3, unread: 2, starred: 1 });
  assert.equal(s.listFeeds()[0].unread, 2);
});

test('list filters, search and ordering; list omits content', () => {
  const s = new Store(null);
  const f = s.addFeed({ url: 'https://a/feed', title: 'A' });
  s.mergeItems(f.id, [item(1), item(2, { title: 'Needle here' }), item(3)]);
  s.setItemState(`${f.id}:i3`, { read: true });
  assert.deepEqual(s.listItems().map(i => i.id.split(':')[1]), ['i3', 'i2', 'i1']);
  assert.equal(s.listItems({ filter: 'unread' }).length, 2);
  assert.equal(s.listItems({ query: 'needle' }).length, 1);
  assert.equal('content' in s.listItems()[0], false);
  assert.equal(s.listItems()[0].feedTitle, 'A');
  assert.equal(s.markAllRead({ feedId: f.id }), 2);
  assert.equal(s.counts().unread, 0);
});

test('duplicate feed rejected; remove deletes its items', () => {
  const s = new Store(null);
  const f = s.addFeed({ url: 'https://a/feed' });
  assert.throws(() => s.addFeed({ url: 'https://a/feed' }), /already subscribed/);
  s.mergeItems(f.id, [item(1)]);
  s.removeFeed(f.id);
  assert.equal(s.counts().total, 0);
});

test('prune caps per-feed items but keeps starred', () => {
  const s = new Store(null);
  const f = s.addFeed({ url: 'https://a/feed' });
  const many = [];
  const base = Date.UTC(2020, 0, 1);
  for (let n = 0; n < MAX_ITEMS_PER_FEED + 20; n++) many.push(item(1, { id: 'x' + n, published: new Date(base + n * 1000).toISOString() }));
  s.mergeItems(f.id, many.slice(0, 5));
  s.setItemState(`${f.id}:x0`, { starred: true });
  s.mergeItems(f.id, many.slice(5));
  assert.equal(s.counts().total, MAX_ITEMS_PER_FEED + 1);
  assert.ok(s.getItem(`${f.id}:x0`));
});

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('example.com/feed'), 'https://example.com/feed');
  assert.equal(normalizeUrl('feed://example.com/x'), 'https://example.com/x');
  assert.throws(() => normalizeUrl(''), /Enter/);
  assert.throws(() => normalizeUrl('ftp://example.com'), /http/);
  assert.throws(() => normalizeUrl('file:///etc/passwd'), /http/);
});

const RSS = n => `<rss><channel><title>Site</title><link>https://s/</link>${Array.from({ length: n }, (_, i) => `<item><title>T${i}</title><guid>g${i}</guid><link>https://s/${i}</link></item>`).join('')}</channel></rss>`;

test('service: add via autodiscovery, refresh adds only new items, errors recorded', async () => {
  const pages = {
    'https://s/': '<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head></html>',
    'https://s/rss': RSS(2)
  };
  const fetcher = async url => {
    if (!(url in pages)) throw new Error('boom');
    return { text: pages[url], url };
  };
  const store = new Store(null);
  const svc = new FeedService(store, { fetchText: fetcher });
  const feed = await svc.addFeed('s');
  assert.equal(feed.url, 'https://s/rss');
  assert.equal(feed.title, 'Site');
  assert.equal(store.counts().total, 2);
  await assert.rejects(svc.addFeed('https://s/rss'), /already subscribed/);

  pages['https://s/rss'] = RSS(3);
  assert.deepEqual(await svc.refreshAll(), { added: 1 });

  delete pages['https://s/rss'];
  const r = await svc.refreshAll();
  assert.equal(r.added, 0);
  assert.equal(store.getFeed(feed.id).error, 'boom');
  assert.equal(store.counts().total, 3);
});

test('service: page without feed gives a friendly error', async () => {
  const svc = new FeedService(new Store(null), { fetchText: async url => ({ text: '<html></html>', url }) });
  await assert.rejects(svc.addFeed('https://nofeed.example'), /No RSS or Atom feed/);
});

test('service: concurrent refreshAll shares one run', async () => {
  let calls = 0;
  const svc = new FeedService(new Store(null), {
    fetchText: async url => { calls++; await new Promise(r => setTimeout(r, 10)); return { text: RSS(1), url }; }
  });
  await svc.addFeed('https://s/rss');
  calls = 0;
  const [a, b] = await Promise.all([svc.refreshAll(), svc.refreshAll()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test('opml round trip and folders', () => {
  const out = buildOpml([{ title: 'A & B', url: 'https://a/feed?x=1&y=2', siteUrl: 'https://a/' }]);
  const back = parseOpml(out);
  assert.deepEqual(back, [{ title: 'A & B', url: 'https://a/feed?x=1&y=2', siteUrl: 'https://a/', folder: '' }]);
  const nested = `<opml version="1.0"><body><outline text="Tech"><outline text="One" xmlUrl="https://one/rss"/><outline text="Two" xmlUrl="https://two/rss"/></outline><outline text="Solo" xmlUrl="https://solo/rss"/></body></opml>`;
  const subs = parseOpml(nested);
  assert.deepEqual(subs.map(s => [s.title, s.folder]), [['One', 'Tech'], ['Two', 'Tech'], ['Solo', '']]);
  assert.throws(() => parseOpml('<rss/>'), /OPML/);
});

test('service: importSubscriptions skips duplicates and bad urls', () => {
  const svc = new FeedService(new Store(null));
  const r = svc.importSubscriptions([{ title: 'a', url: 'https://a/rss' }, { title: 'a2', url: 'https://a/rss' }, { title: 'bad', url: 'ftp://x' }]);
  assert.deepEqual(r, { added: 1, skipped: 2 });
});
