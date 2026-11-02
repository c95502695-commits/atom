'use strict';

const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true
});

const asArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Extract text from a parsed XML node (string, attribute-bearing object, or array). */
function text(node) {
  if (node === undefined || node === null) return '';
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') {
    if (node['#text'] !== undefined) return String(node['#text']);
    // XHTML payloads (Atom type="xhtml") – flatten any nested text.
    return Object.entries(node)
      .filter(([k]) => !k.startsWith('@_'))
      .map(([, v]) => text(v))
      .join(' ')
      .trim();
  }
  return String(node);
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', copy: '©'
};

function decodeEntities(str) {
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Convert an HTML fragment to collapsed plain text. */
function htmlToText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function makeSummary(html, max = 220) {
  const plain = htmlToText(html);
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain;
}

function toIsoDate(value) {
  const s = text(value);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function resolveUrl(href, base) {
  if (!href) return '';
  try {
    return new URL(href, base || undefined).toString();
  } catch {
    return '';
  }
}

function firstImage(html, base) {
  const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html || '');
  return m ? resolveUrl(decodeEntities(m[1]), base) : '';
}

function findImage(item, html, base) {
  for (const enc of asArray(item.enclosure)) {
    const type = enc['@_type'] || '';
    if (type.startsWith('image/') && enc['@_url']) return resolveUrl(enc['@_url'], base);
  }
  for (const key of ['media:thumbnail', 'media:content']) {
    for (const m of asArray(item[key])) {
      const medium = m['@_medium'];
      const type = m['@_type'] || '';
      if (m['@_url'] && (key === 'media:thumbnail' || medium === 'image' || type.startsWith('image/'))) {
        return resolveUrl(m['@_url'], base);
      }
    }
  }
  return firstImage(html, base);
}

function itemId(raw, title, link, published) {
  const basis = raw || link || `${title}|${published || ''}`;
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 20);
}

function atomLink(links, base, wantedRel = 'alternate') {
  const list = asArray(links);
  const hit = list.find(l => (l['@_rel'] || 'alternate') === wantedRel && l['@_href']);
  return hit ? resolveUrl(hit['@_href'], base) : '';
}

function parseRss(channel, root, feedUrl) {
  const siteUrl = resolveUrl(text(channel.link), feedUrl) || atomLink(channel['atom:link'], feedUrl);
  const items = asArray(channel.item || root.item).map(item => {
    const title = htmlToText(text(item.title));
    const guidIsLink = item.guid && typeof item.guid === 'object' && item.guid['@_isPermaLink'] !== 'false';
    const link =
      resolveUrl(text(item.link), siteUrl || feedUrl) ||
      (guidIsLink ? resolveUrl(text(item.guid), feedUrl) : '');
    const published = toIsoDate(item.pubDate || item['dc:date'] || item.date);
    const content = text(item['content:encoded']) || text(item.description);
    const author = htmlToText(text(item['dc:creator']) || text(item.author));
    return {
      id: itemId(text(item.guid), title, link, published),
      title: title || '(untitled)',
      link,
      author,
      published,
      summary: makeSummary(text(item.description) || content),
      content,
      image: findImage(item, content, link || siteUrl || feedUrl)
    };
  });
  return {
    title: htmlToText(text(channel.title)),
    siteUrl,
    description: htmlToText(text(channel.description)),
    items
  };
}

function parseAtom(feed, feedUrl) {
  const base = feed['@_xml:base'] || feedUrl;
  const siteUrl = atomLink(feed.link, base);
  const items = asArray(feed.entry).map(entry => {
    const ebase = entry['@_xml:base'] || base;
    const title = htmlToText(text(entry.title));
    const link = atomLink(entry.link, ebase);
    const published = toIsoDate(entry.published || entry.updated || entry['dc:date']);
    const content = text(entry.content) || text(entry.summary);
    const authors = asArray(entry.author).map(a => text(a.name)).filter(Boolean);
    return {
      id: itemId(text(entry.id), title, link, published),
      title: title || '(untitled)',
      link,
      author: authors.join(', '),
      published,
      summary: makeSummary(text(entry.summary) || content),
      content,
      image: findImage(entry, content, link || base)
    };
  });
  return {
    title: htmlToText(text(feed.title)),
    siteUrl,
    description: htmlToText(text(feed.subtitle)),
    items
  };
}

/**
 * Parse an RSS 2.0, RSS 1.0 (RDF) or Atom 1.0 document.
 * @returns {{title:string, siteUrl:string, description:string, items:object[]}}
 * @throws if the document is not a recognised feed.
 */
function parseFeed(source, feedUrl = '') {
  let doc;
  try {
    doc = xml.parse(String(source).replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error('Not a valid XML feed: ' + e.message);
  }
  if (doc.rss && doc.rss.channel) return parseRss(asArray(doc.rss.channel)[0], doc.rss, feedUrl);
  if (doc['rdf:RDF'] && doc['rdf:RDF'].channel) {
    const root = doc['rdf:RDF'];
    return parseRss(asArray(root.channel)[0], root, feedUrl);
  }
  if (doc.feed) return parseAtom(doc.feed, feedUrl);
  throw new Error('The document is not an RSS or Atom feed');
}

/** Find feed URLs advertised by an HTML page via <link rel="alternate">. */
function discoverFeedUrls(html, baseUrl) {
  const found = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html || ''))) {
    const tag = m[0];
    const attr = name => {
      const a = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
      return a ? (a[2] !== undefined ? a[2] : a[3]) : '';
    };
    const rel = attr('rel').toLowerCase().split(/\s+/);
    const type = attr('type').toLowerCase();
    if (rel.includes('alternate') && /(rss|atom)\+xml|application\/xml|text\/xml/.test(type)) {
      const url = resolveUrl(decodeEntities(attr('href')), baseUrl);
      if (url && !found.includes(url)) found.push(url);
    }
  }
  return found;
}

module.exports = { parseFeed, discoverFeedUrls, htmlToText, makeSummary, decodeEntities };
