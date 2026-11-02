'use strict';

(function () {
  const api = window.api;
  const $ = id => document.getElementById(id);

  const state = {
    feeds: [],
    counts: { total: 0, unread: 0, starred: 0 },
    view: { type: 'smart', id: 'all' }, // smart: all|unread|starred, or feed
    filter: 'all',
    query: '',
    items: [],
    selectedId: null,
    current: null,
    refreshing: false,
    editingFeed: null
  };

  const el = {
    smart: $('smart-list'),
    feeds: $('feed-list'),
    items: $('item-list'),
    title: $('list-title'),
    status: $('status'),
    filter: $('filter'),
    search: $('search'),
    empty: $('reader-empty'),
    article: $('article'),
    aTitle: $('a-title'),
    aMeta: $('a-meta'),
    aBody: $('a-body'),
    aStar: $('a-star'),
    aRead: $('a-read'),
    refresh: $('btn-refresh')
  };

  const SMART = [
    { id: 'all', label: 'All articles', glyph: '\u{1F4F0}', filter: 'all', count: c => c.unread },
    { id: 'unread', label: 'Unread', glyph: '\u25CF', filter: 'unread', count: c => c.unread },
    { id: 'starred', label: 'Starred', glyph: '\u2605', filter: 'starred', count: c => c.starred }
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function relTime(iso) {
    if (!iso) return '';
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return 'just now';
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function node(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  }

  function setStatus(msg, isError) {
    el.status.textContent = msg || '';
    el.status.classList.toggle('error', !!isError);
  }

  // ---- sidebar ----------------------------------------------------------

  const isActive = (type, id) => state.view.type === type && state.view.id === id;
  const badge = n => (n > 0 ? node('span', { class: 'badge', text: n > 999 ? '999+' : String(n) }) : null);

  function renderSidebar() {
    el.smart.replaceChildren(
      ...SMART.map(s =>
        node('li', {
          class: 'nav-item' + (isActive('smart', s.id) ? ' active' : ''),
          role: 'button',
          tabindex: '0',
          onclick: () => selectView('smart', s.id),
          onkeydown: e => e.key === 'Enter' && selectView('smart', s.id)
        },
        node('span', { class: 'glyph', text: s.glyph }),
        node('span', { class: 'label', text: s.label }),
        badge(s.count(state.counts)))
      )
    );
    el.feeds.replaceChildren(
      ...state.feeds.map(f =>
        node('li', {
          class: 'nav-item' + (isActive('feed', f.id) ? ' active' : ''),
          role: 'button',
          tabindex: '0',
          title: f.error ? 'Error: ' + f.error : f.url,
          onclick: () => selectView('feed', f.id),
          onkeydown: e => e.key === 'Enter' && selectView('feed', f.id),
          oncontextmenu: e => {
            e.preventDefault();
            openFeedDialog(f);
          }
        },
        node('span', { class: 'glyph' + (f.error ? ' warn' : ''), text: f.error ? '\u26A0' : '\u25A4' }),
        node('span', { class: 'label', text: f.title }),
        badge(f.unread),
        node('button', {
          class: 'icon tiny',
          title: 'Feed settings',
          'aria-label': 'Feed settings',
          text: '\u22EF',
          onclick: e => {
            e.stopPropagation();
            openFeedDialog(f);
          }
        }))
      )
    );
  }

  // ---- article list -----------------------------------------------------

  function viewTitle() {
    if (state.view.type === 'feed') {
      const f = state.feeds.find(x => x.id === state.view.id);
      return f ? f.title : 'Feed';
    }
    return SMART.find(s => s.id === state.view.id).label;
  }

  function listOptions() {
    const opts = { query: state.query, filter: state.filter };
    if (state.view.type === 'feed') opts.feedId = state.view.id;
    return opts;
  }

  async function loadItems() {
    state.items = await api.listItems(listOptions());
    el.title.textContent = viewTitle();
    renderItems();
  }

  function renderItems() {
    if (!state.items.length) {
      let msg = 'No articles here yet.';
      if (state.query) msg = 'No articles match your search.';
      else if (!state.feeds.length) msg = 'Add a feed to get started.';
      else if (state.filter === 'unread') msg = "You're all caught up \u{1F389}";
      el.items.replaceChildren(node('li', { class: 'list-empty', text: msg }));
      return;
    }
    el.items.replaceChildren(...state.items.map(itemNode));
  }

  function itemNode(i) {
    return node('li', {
      class: 'item' + (i.read ? ' read' : '') + (i.id === state.selectedId ? ' selected' : ''),
      'data-id': i.id,
      role: 'option',
      onclick: () => selectItem(i.id)
    },
    node('div', { class: 'item-text' },
      node('div', { class: 'item-source' },
        node('span', { class: 'dot' }),
        node('span', { class: 'src', text: i.feedTitle }),
        node('span', { class: 'time', text: relTime(i.published || i.fetchedAt) }),
        i.starred ? node('span', { class: 'star', text: '\u2605' }) : null),
      node('div', { class: 'item-title', text: i.title }),
      node('div', { class: 'item-summary', text: i.summary })),
    i.image
      ? node('img', { class: 'thumb', src: i.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.remove() })
      : null);
  }

  // ---- reader -----------------------------------------------------------

  function updateActionButtons() {
    const c = state.current;
    if (!c) return;
    el.aStar.textContent = c.starred ? '\u2605 Starred' : '\u2606 Star';
    el.aStar.classList.toggle('on', c.starred);
    el.aRead.textContent = c.read ? 'Mark unread' : 'Mark read';
  }

  function showReader(item) {
    state.current = item;
    el.empty.classList.toggle('hidden', !!item);
    el.article.classList.toggle('hidden', !item);
    if (!item) return;
    el.aTitle.textContent = item.title;
    const bits = [item.feedTitle, item.author, item.published && new Date(item.published).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean);
    el.aMeta.textContent = bits.join(' \u00B7 ');
    el.aBody.replaceChildren(window.sanitizeHtml(item.content || item.summary, item.link));
    el.article.scrollTop = 0;
    el.aBody.parentElement.scrollTop = 0;
    document.getElementById('reader').scrollTop = 0;
    updateActionButtons();
  }

  async function selectItem(id) {
    state.selectedId = id;
    for (const li of el.items.children) li.classList.toggle('selected', li.dataset.id === id);
    const item = await api.getItem(id);
    showReader(item);
    if (item && !item.read) {
      await api.setItemState(id, { read: true });
      item.read = true;
      patchListItem(id, { read: true });
      await refreshCounts();
    }
    const li = el.items.querySelector('li.selected');
    if (li) li.scrollIntoView({ block: 'nearest' });
  }

  function patchListItem(id, patch) {
    const i = state.items.find(x => x.id === id);
    if (!i) return;
    Object.assign(i, patch);
    const li = el.items.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (li) li.replaceWith(itemNode(i));
  }

  async function toggleStar() {
    const c = state.current;
    if (!c) return;
    c.starred = !c.starred;
    await api.setItemState(c.id, { starred: c.starred });
    patchListItem(c.id, { starred: c.starred });
    updateActionButtons();
    await refreshCounts();
  }

  async function toggleRead() {
    const c = state.current;
    if (!c) return;
    c.read = !c.read;
    await api.setItemState(c.id, { read: c.read });
    patchListItem(c.id, { read: c.read });
    updateActionButtons();
    await refreshCounts();
  }

  function openCurrent() {
    if (state.current && state.current.link) api.openExternal(state.current.link).catch(e => setStatus(e.message, true));
  }

  function step(delta) {
    if (!state.items.length) return;
    const idx = state.items.findIndex(i => i.id === state.selectedId);
    const next = Math.min(state.items.length - 1, Math.max(0, idx + delta));
    if (next !== idx || idx === -1) selectItem(state.items[idx === -1 ? 0 : next].id);
  }

  // ---- data refresh -----------------------------------------------------

  async function refreshCounts() {
    const [feeds, counts] = await Promise.all([api.listFeeds(), api.counts()]);
    state.feeds = feeds;
    state.counts = counts;
    renderSidebar();
  }

  async function reloadAll() {
    await refreshCounts();
    if (state.view.type === 'feed' && !state.feeds.some(f => f.id === state.view.id)) {
      state.view = { type: 'smart', id: 'all' };
      state.filter = 'all';
      el.filter.value = 'all';
      renderSidebar();
    }
    await loadItems();
  }

  function selectView(type, id) {
    state.view = { type, id };
    if (type === 'smart') {
      state.filter = SMART.find(s => s.id === id).filter;
      el.filter.value = state.filter;
    }
    renderSidebar();
    loadItems().catch(e => setStatus(e.message, true));
  }

  async function doRefresh() {
    if (state.refreshing) return;
    setStatus('Refreshing feeds\u2026');
    try {
      const r = await api.refresh();
      const failed = state.feeds.filter(f => f.error).length;
      setStatus(
        (r.added ? `${r.added} new article${r.added === 1 ? '' : 's'}` : 'Up to date') +
          (failed ? ` \u00B7 ${failed} feed${failed === 1 ? '' : 's'} failed` : ''),
        failed > 0
      );
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  // ---- dialogs ----------------------------------------------------------

  const dlgAdd = $('dlg-add');
  const dlgFeed = $('dlg-feed');

  function openAddDialog() {
    $('add-url').value = '';
    $('add-error').textContent = '';
    $('add-submit').disabled = false;
    $('add-submit').textContent = 'Subscribe';
    if (!dlgAdd.open) dlgAdd.showModal();
    $('add-url').focus();
  }

  $('form-add').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('add-submit');
    btn.disabled = true;
    btn.textContent = 'Subscribing\u2026';
    $('add-error').textContent = '';
    try {
      const feed = await api.addFeed($('add-url').value);
      dlgAdd.close();
      await reloadAll();
      selectView('feed', feed.id);
    } catch (err) {
      $('add-error').textContent = err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
      btn.disabled = false;
      btn.textContent = 'Subscribe';
    }
  });
  $('add-cancel').addEventListener('click', () => dlgAdd.close());

  function openFeedDialog(feed) {
    state.editingFeed = feed;
    $('feed-name').value = feed.title;
    $('feed-url').textContent = feed.url + (feed.error ? `\nLast error: ${feed.error}` : '');
    $('feed-error').textContent = '';
    dlgFeed.showModal();
  }

  $('form-feed').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.renameFeed(state.editingFeed.id, $('feed-name').value);
      dlgFeed.close();
      await reloadAll();
    } catch (err) {
      $('feed-error').textContent = err.message;
    }
  });
  $('feed-cancel').addEventListener('click', () => dlgFeed.close());
  $('feed-remove').addEventListener('click', async () => {
    if (!window.confirm(`Unsubscribe from "${state.editingFeed.title}"? Its articles will be removed.`)) return;
    await api.removeFeed(state.editingFeed.id);
    dlgFeed.close();
    showReader(null);
    state.selectedId = null;
    await reloadAll();
  });

  // ---- wiring -----------------------------------------------------------

  $('btn-add').addEventListener('click', openAddDialog);
  el.refresh.addEventListener('click', doRefresh);
  $('btn-import').addEventListener('click', importOpml);
  $('btn-export').addEventListener('click', exportOpml);
  $('a-star').addEventListener('click', toggleStar);
  $('a-read').addEventListener('click', toggleRead);
  $('a-open').addEventListener('click', openCurrent);

  $('btn-mark-all').addEventListener('click', async () => {
    await api.markAllRead(state.view.type === 'feed' ? { feedId: state.view.id } : {});
    await reloadAll();
    if (state.current) showReader(await api.getItem(state.current.id));
  });

  el.filter.addEventListener('change', () => {
    state.filter = el.filter.value;
    loadItems();
  });

  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = el.search.value;
      loadItems();
    }, 150);
  });

  // Links inside articles open in the default browser.
  el.aBody.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href) api.openExternal(href).catch(err => setStatus(err.message, true));
  });

  async function importOpml() {
    try {
      const r = await api.importOpml();
      if (r) {
        setStatus(`Imported ${r.added} feed${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
        await reloadAll();
      }
    } catch (e) {
      setStatus('Import failed: ' + e.message, true);
    }
  }

  async function exportOpml() {
    try {
      const p = await api.exportOpml();
      if (p) setStatus('Exported to ' + p);
    } catch (e) {
      setStatus('Export failed: ' + e.message, true);
    }
  }

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      el.search.focus();
      el.search.select();
      return;
    }
    if (e.key === 'Escape' && typing && document.activeElement === el.search) {
      el.search.value = '';
      state.query = '';
      el.search.blur();
      loadItems();
      return;
    }
    if (typing || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('dialog[open]')) return;
    switch (e.key.toLowerCase()) {
      case 'j': step(1); break;
      case 'k': step(-1); break;
      case 'm': toggleRead(); break;
      case 's': toggleStar(); break;
      case 'o': openCurrent(); break;
      default:
    }
  });

  api.onMenu(action => {
    if (action === 'add-feed') openAddDialog();
    else if (action === 'import') importOpml();
    else if (action === 'export') exportOpml();
    else if (action === 'search') { el.search.focus(); el.search.select(); }
  });
  api.onRefreshState(({ refreshing }) => {
    state.refreshing = refreshing;
    el.refresh.classList.toggle('spinning', refreshing);
    if (refreshing) setStatus('Refreshing feeds\u2026');
  });
  api.onDataChanged(() => reloadAll().catch(e => setStatus(e.message, true)));

  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  api.isDark().then(applyTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => applyTheme(e.matches));

  reloadAll().catch(e => setStatus(e.message, true));
})();
