'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed, discoverFeedUrls, htmlToText } = require('../src/feed-parser');

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Example &amp; Co</title>
  <link>https://example.com/</link>
  <description>News</description>
  <item>
    <title>First &lt;b&gt;post&lt;/b&gt;</title>
    <link>/posts/1</link>
    <guid isPermaLink="false">abc-1</guid>
    <pubDate>Mon, 02 Jan 2023 10:00:00 GMT</pubDate>
    <dc:creator>Ann</dc:creator>
    <description><![CDATA[<p>Hello <em>world</em> &amp; friends</p>]]></description>
    <content:encoded><![CDATA[<p>Full <img src="/img/a.png"> body</p>]]></content:encoded>
  </item>
  <item>
    <title>Second</title>
    <link>https://example.com/posts/2</link>
    <media:thumbnail url="https://cdn.example.com/t.jpg"/>
    <description>Plain</description>
  </item>
  <item><title>Single enclosure</title><enclosure url="https://x/y.png" type="image/png"/></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Blog</title>
  <subtitle>sub</subtitle>
  <link rel="self" href="https://blog.example/feed.atom"/>
  <link rel="alternate" href="https://blog.example/"/>
  <entry>
    <title type="html">Hi &amp;amp; bye</title>
    <id>tag:blog.example,2023:1</id>
    <link rel="alternate" href="/e/1"/>
    <updated>2023-03-04T05:06:07Z</updated>
    <author><name>Bob</name></author>
    <summary>Short</summary>
    <content type="html">&lt;p&gt;Body text&lt;/p&gt;</content>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>RDF Feed</title><link>https://rdf.example/</link></channel>
  <item><title>Old school</title><link>https://rdf.example/1</link><dc:date>2020-01-01T00:00:00Z</dc:date></item>
</rdf:RDF>`;

test('parses RSS 2.0', () => {
  const f = parseFeed(RSS, 'https://example.com/feed.xml');
  assert.equal(f.title, 'Example & Co');
  assert.equal(f.siteUrl, 'https://example.com/');
  assert.equal(f.items.length, 3);
  const [a, b, c] = f.items;
  assert.equal(a.title, 'First post');
  assert.equal(a.link, 'https://example.com/posts/1');
  assert.equal(a.author, 'Ann');
  assert.equal(a.published, '2023-01-02T10:00:00.000Z');
  assert.equal(a.summary, 'Hello world & friends');
  assert.match(a.content, /Full/);
  assert.equal(a.image, 'https://example.com/img/a.png');
  assert.equal(b.image, 'https://cdn.example.com/t.jpg');
  assert.equal(c.image, 'https://x/y.png');
  assert.equal(new Set(f.items.map(i => i.id)).size, 3);
});

test('parses Atom', () => {
  const f = parseFeed(ATOM, 'https://blog.example/feed.atom');
  assert.equal(f.title, 'Atom Blog');
  assert.equal(f.siteUrl, 'https://blog.example/');
  assert.equal(f.items.length, 1);
  const e = f.items[0];
  assert.equal(e.title, 'Hi & bye');
  assert.equal(e.link, 'https://blog.example/e/1');
  assert.equal(e.author, 'Bob');
  assert.equal(e.published, '2023-03-04T05:06:07.000Z');
  assert.equal(e.summary, 'Short');
  assert.equal(e.content, '<p>Body text</p>');
});

test('parses RSS 1.0 (RDF)', () => {
  const f = parseFeed(RDF, 'https://rdf.example/rss');
  assert.equal(f.title, 'RDF Feed');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].published, '2020-01-01T00:00:00.000Z');
});

test('ids are stable across parses', () => {
  assert.deepEqual(
    parseFeed(RSS, 'u').items.map(i => i.id),
    parseFeed(RSS, 'u').items.map(i => i.id)
  );
});

test('rejects non-feed documents', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>', 'u'), /not an RSS or Atom/);
  assert.throws(() => parseFeed('', 'u'));
});

test('handles a feed with zero items and BOM', () => {
  const f = parseFeed('\uFEFF<rss><channel><title>T</title></channel></rss>', 'u');
  assert.equal(f.items.length, 0);
  assert.equal(f.title, 'T');
});

test('discovers feed links in HTML', () => {
  const html = `<head>
    <link rel="stylesheet" href="/a.css">
    <link rel="alternate" type="application/rss+xml" title="x" href="/feed.xml">
    <link href='https://other/atom' type='application/atom+xml' rel='alternate'>
    <link rel="alternate" type="text/html" href="/fr"></head>`;
  assert.deepEqual(discoverFeedUrls(html, 'https://site.example/blog/'), [
    'https://site.example/feed.xml',
    'https://other/atom'
  ]);
});

test('htmlToText strips tags, scripts and decodes entities', () => {
  assert.equal(htmlToText('<p>A&nbsp;&lt;B&gt; &#8212; &#x263A;</p><script>evil()</script>'), 'A <B> \u2014 \u263A');
});
