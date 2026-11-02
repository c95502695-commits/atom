'use strict';

/**
 * Whitelist-based HTML sanitizer for untrusted feed content.
 * Parses with DOMParser (inert – no scripts run, no resources load) and rebuilds
 * a clean tree. Exposed as window.sanitizeHtml(html, baseUrl) -> DocumentFragment.
 */
(function () {
  const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt',
    'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
    'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
  ]);
  const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'select', 'textarea', 'button', 'video', 'audio', 'canvas', 'head', 'title', 'meta', 'link']);
  const ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] };

  function safeUrl(value, base, protocols) {
    try {
      const u = new URL(String(value).trim(), base || undefined);
      return protocols.includes(u.protocol) ? u.toString() : null;
    } catch {
      return null;
    }
  }

  function clean(node, out, base) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(child.nodeValue));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (DROP_WITH_CONTENT.has(tag)) continue;
        if (!ALLOWED_TAGS.has(tag)) {
          clean(child, out, base); // unwrap unknown element, keep its text
          continue;
        }
        const el = document.createElement(tag);
        for (const name of ATTRS[tag] || []) {
          if (!child.hasAttribute(name)) continue;
          const val = child.getAttribute(name);
          if (name === 'href') {
            const url = safeUrl(val, base, ['http:', 'https:', 'mailto:']);
            if (url) el.setAttribute('href', url);
          } else if (name === 'src') {
            const url = safeUrl(val, base, ['http:', 'https:']);
            if (url) el.setAttribute('src', url);
          } else if (/^(width|height|colspan|rowspan|start)$/.test(name)) {
            if (/^\d{1,4}$/.test(val)) el.setAttribute(name, val);
          } else {
            el.setAttribute(name, val);
          }
        }
        if (tag === 'img') {
          if (!el.getAttribute('src')) continue;
          el.setAttribute('loading', 'lazy');
          el.setAttribute('referrerpolicy', 'no-referrer');
        }
        if (tag === 'a') el.setAttribute('rel', 'noopener noreferrer');
        clean(child, el, base);
        out.appendChild(el);
      }
    }
  }

  window.sanitizeHtml = function (html, base) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const frag = document.createDocumentFragment();
    clean(doc.body, frag, base);
    return frag;
  };
})();
