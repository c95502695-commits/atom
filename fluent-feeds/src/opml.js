'use strict';

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true
});

const asArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Parse OPML into a flat list of subscriptions. */
function parseOpml(source) {
  const doc = parser.parse(String(source).replace(/^\uFEFF/, ''));
  if (!doc.opml || !doc.opml.body) throw new Error('Not a valid OPML file');
  const out = [];
  const walk = (outlines, folder) => {
    for (const o of asArray(outlines)) {
      const url = o['@_xmlUrl'] || o['@_xmlurl'];
      const title = o['@_title'] || o['@_text'] || '';
      if (url) {
        out.push({ title, url, siteUrl: o['@_htmlUrl'] || '', folder });
      }
      if (o.outline) walk(o.outline, url ? folder : title || folder);
    }
  };
  walk(doc.opml.body.outline, '');
  return out;
}

const esc = s =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Serialise feeds ({title,url,siteUrl}) to OPML 2.0. */
function buildOpml(feeds, title = 'Fluent Feeds subscriptions') {
  const lines = feeds.map(
    f =>
      `    <outline type="rss" text="${esc(f.title || f.url)}" title="${esc(f.title || f.url)}" xmlUrl="${esc(f.url)}" htmlUrl="${esc(f.siteUrl)}"/>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>${esc(title)}</title></head>
  <body>
${lines.join('\n')}
  </body>
</opml>
`;
}

module.exports = { parseOpml, buildOpml };
