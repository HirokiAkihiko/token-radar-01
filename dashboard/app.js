// Token Launch Radar dashboard. Static and offline: it renders only the
// dataset main.ts generated beside it (window.RADAR in ../data.js).
// Views: the ranked pre-token board, a per-protocol detail dialog with the
// full valuation breakdown and farm plan, a live-token comparables view,
// and a methodology panel showing the peer multiples the model learned
// from the snapshot's traded protocols.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('board-region');
  var view = { q: '', category: 'all', chain: 'all', tier: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function fmtPct(n) { return (n === null || n === undefined) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    return d >= 365 ? (d / 365).toFixed(1) + ' yrs' : d + ' days';
  }
  function recompute(row) {
    // The board's own arithmetic, repeated in the page so a reader can
    // verify any row: TVL x category multiple x the three adjustments.
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.growth_multiplier * row.maturity_multiplier * row.breadth_multiplier));
  }
  function node(tag, attrs) {
    var elx = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') elx.className = attrs[k];
      else if (k === 'text') elx.textContent = attrs[k];
      else if (k.indexOf('on') === 0) elx.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) elx.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) elx.appendChild(x); });
      else elx.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return elx;
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && (r.category || 'Uncategorised') !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (view.tier !== 'all' && r.confidence_tier !== view.tier) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (view.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (view.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (view.sort === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (view.sort === 'confidence') { av = a.confidence; bv = b.confidence; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function headerBar() {
    return node('div', { class: 'topbar' },
      node('div', { class: 'brand' }, node('span', { class: 'radar-dot' }), node('span', { text: 'TOKEN LAUNCH RADAR' })),
      node('div', { class: 'top-meta' },
        node('span', { text: 'Snapshot ' + DATA.as_of }),
        node('span', { text: 'Source: DefiLlama protocol index (sealed)' }),
        node('span', { text: 'Model ' + DATA.model_version })));
  }
  function hero() {
    var top = DATA.rows[0];
    return node('section', { class: 'hero' },
      node('div', null,
        node('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        node('p', null,
          'Every protocol below records no token in the snapshot. Each is valued at the multiple its category\u2019s already-traded peers actually command per dollar of TVL, adjusted for momentum, maturity and chain breadth. ',
          node('b', { text: 'Strongest signal right now: ' + top.name + ' at ' + fmtMoney(top.implied_value_usd) + ' implied.' }),
          ' Implied value is this entry\u2019s model claim, not a price prediction and not a promise of a launch.')),
      node('div', { class: 'stat-grid' },
        node('div', { class: 'stat' }, node('span', { text: 'Watchlist covered' }), node('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        node('div', { class: 'stat' }, node('span', { text: 'Protocols ranked' }), node('b', { text: String(DATA.board_size) })),
        node('div', { class: 'stat' }, node('span', { text: 'Early finds below $50M floor' }), node('b', { text: String(DATA.early_size) })),
        node('div', { class: 'stat' }, node('span', { text: 'Market-wide peer multiple' }), node('b', { text: DATA.overall_multiple.toFixed(3) + 'x TVL' }))));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = node('input', { type: 'search', id: 'q', placeholder: 'Search protocol, category, chain', 'aria-label': 'Search the board' });
    search.value = view.q;
    search.addEventListener('input', function () { view.q = search.value; render(); var el2 = document.getElementById('q'); if (el2) { el2.focus(); el2.setSelectionRange(el2.value.length, el2.value.length); } });
    function select(id, label, values, current, apply) {
      var s = node('select', { id: id, 'aria-label': label },
        node('option', { value: 'all', text: label + ': all' }),
        values.map(function (v) { return node('option', { value: v, text: v, selected: v === current ? 'selected' : null }); }));
      s.addEventListener('change', function () { apply(s.value); render(); });
      return node('div', { class: 'field' }, node('label', { for: id, text: label }), s);
    }
    var boardBtn = node('button', { type: 'button', 'aria-pressed': view.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { view.tab = 'board'; render(); } });
    var liveBtn = node('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live-token peers', onclick: function () { view.tab = 'live'; render(); } });
    return node('div', { class: 'controls' },
      node('div', { class: 'field' }, node('label', { for: 'q', text: 'Search' }), search),
      select('f-category', 'Category', cats, view.category, function (v) { view.category = v; }),
      select('f-chain', 'Chain', chains, view.chain, function (v) { view.chain = v; }),
      select('f-tier', 'Confidence', ['High', 'Medium', 'Early'], view.tier, function (v) { view.tier = v; }),
      node('div', { class: 'field' }, node('span', { class: 'lbl', text: 'View' }), node('div', { class: 'tabs' }, boardBtn, liveBtn)),
      node('span', { class: 'count', text: view.tab === 'board' ? visibleRows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' traded peers shown' }));
  }
  function headCell(key, label) {
    return node('th', { scope: 'col' }, node('button', { type: 'button', onclick: function () {
      if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } render();
    }, text: '' }, label + (view.sort === key ? (view.dir < 0 ? ' \u25bc' : ' \u25b2') : '')));
  }
  function boardPanel() {
    var list = sorted(visibleRows());
    if (list.length === 0) {
      return node('div', { class: 'panel' }, node('div', { class: 'empty' },
        node('h2', { text: 'Nothing matches those filters' }),
        node('p', { text: 'Try a different category, chain or confidence tier, or clear the search.' }),
        node('button', { class: 'btn primary', type: 'button', text: 'Reset all filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; view.tier = 'all'; render(); } })));
    }
    var peak = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    var body = node('tbody');
    list.forEach(function (r) {
      body.appendChild(node('tr', { tabindex: '0', 'data-selected': view.selected === r.slug ? 'true' : 'false',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        node('td', { class: 'num', text: '#' + r.rank }),
        node('td', null, node('div', { class: 'pname' }, node('b', { text: r.name }), node('span', { text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains || []).slice(0, 3).join(', ') }))),
        node('td', { class: 'num', text: fmtMoney(r.tvl_usd) }),
        node('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        node('td', { class: 'num', text: fmtAge(r.age_days) }),
        node('td', null, node('div', { class: 'bar-wrap' }, node('span', { class: 'bar', 'aria-hidden': 'true' }, node('i', { style: 'width:' + Math.max(3, Math.round(r.implied_value_usd / peak * 100)) + '%' })), node('span', { class: 'num', text: fmtMoney(r.implied_value_usd) }))),
        node('td', null, node('span', { class: 'pill ' + r.confidence_tier.toLowerCase(), text: r.confidence_tier + ' \u00b7 ' + r.confidence }))));
    });
    return node('div', { class: 'panel' }, node('div', { class: 'table-scroll' },
      node('table', null,
        node('caption', { text: 'Pre-token protocols ranked by peer-implied launch value. Select any row for its full breakdown and farm plan.' }),
        node('thead', null, node('tr', null, headCell('implied', 'Rank'), headCell('name', 'Protocol'), headCell('tvl', 'TVL'), headCell('growth', '7d change'), node('th', { scope: 'col', text: 'Age' }), headCell('implied', 'Implied value'), headCell('confidence', 'Confidence'))),
        body)));
  }
  function livePanel() {
    var body = node('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(node('tr', null,
        node('td', null, node('div', { class: 'pname' }, node('b', { text: r.name }), node('span', { text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains || []).slice(0, 3).join(', ') }))),
        node('td', { class: 'num', text: fmtMoney(r.tvl_usd) }),
        node('td', { class: 'num', text: fmtMoney(r.mcap_usd) }),
        node('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(3) + 'x' }),
        node('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })));
    });
    return node('div', { class: 'panel' }, node('div', { class: 'table-scroll' },
      node('table', null,
        node('caption', { text: 'These protocols already trade, so their market caps are facts. Their category medians are exactly the multiples the pre-token board is valued with.' }),
        node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Traded peer' }), node('th', { scope: 'col', text: 'TVL' }), node('th', { scope: 'col', text: 'Market cap' }), node('th', { scope: 'col', text: 'Mcap / TVL' }), node('th', { scope: 'col', text: '7d change' }))),
        body)));
  }
  function methodPanel() {
    var body = node('tbody');
    DATA.categories.forEach(function (c) {
      body.appendChild(node('tr', null,
        node('td', { text: c.category }),
        node('td', { class: 'num', text: String(c.peers) }),
        node('td', { class: 'num', text: c.raw_median.toFixed(3) + 'x' }),
        node('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' })));
    });
    return node('section', { class: 'panel method' },
      node('h2', { text: 'How the radar values a protocol with no token' }),
      node('p', { text: 'The snapshot itself contains the yardstick: protocols that already trade reveal what the market pays per dollar of TVL in each category. The model takes the median market-cap / TVL of a category\u2019s traded peers, shrinks it toward the market-wide median (' + DATA.overall_multiple.toFixed(3) + 'x) when the peer sample is small, caps it between 0.03x and 1.00x, then adjusts for momentum, maturity and chain breadth. No protocol name is special-cased and no figure comes from outside the snapshot.' }),
      node('div', { class: 'formula', text: 'implied = TVL \u00d7 category multiple (shrunk median of traded peers) \u00d7 (1 + clamp(7d change, \u221250, 100)/100 \u00d7 0.6) \u00d7 (0.65 + min(age days, 1095)/1095 \u00d7 0.5) \u00d7 (1 + 0.04 \u00d7 log2(chains), capped 1.16)' }),
      node('p', { text: 'Confidence is evidence quality, separate from value: peer depth for the category, a known listing age, absolute TVL and chain breadth. Early-tier rows are real radar finds, but their multiples rest on thinner evidence. Age unknown counts as 365 days. A protocol that records no token may still have one DefiLlama does not carry; the board says \u201crecords no token\u201d, never \u201chas none\u201d.' }),
      node('div', { class: 'table-scroll' }, node('table', { class: 'mult-table' },
        node('caption', { text: 'Category multiples learned from this snapshot (categories with at least two traded peers).' }),
        node('thead', null, node('tr', null, node('th', { scope: 'col', text: 'Category' }), node('th', { scope: 'col', text: 'Traded peers' }), node('th', { scope: 'col', text: 'Raw median' }), node('th', { scope: 'col', text: 'Multiple used' }))),
        body)));
  }

  var dialog = node('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    dialog.textContent = '';
    var steps = (row.farm_steps || []).map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var action = cut >= 0 ? s.slice(0, cut) : s;
      var tail = cut >= 0 ? s.slice(cut + 1) : '';
      return node('li', null, node('span', { text: action }), tail ? node('span', { class: 'cost', text: tail }) : null);
    });
    var kv = function (label, value) { return node('div', { class: 'kv' }, node('span', { text: label }), node('b', { text: value })); };
    dialog.appendChild(node('div', { class: 'detail-inner' },
      node('div', { class: 'detail-head' },
        node('div', null,
          node('span', { class: 'sub', text: 'Rank #' + row.rank + ' of ' + DATA.board_size + ' \u00b7 records no token' }),
          node('h2', { id: 'detail-title', text: row.name }),
          node('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') + ' \u00b7 first tracked ' + (row.listed_at || 'date unknown') })),
        node('button', { class: 'close-btn', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })),
      node('h3', { text: 'Valuation breakdown' }),
      node('div', { class: 'kv-grid' },
        kv('TVL', fmtMoney(row.tvl_usd)),
        kv('Category multiple', row.category_multiple.toFixed(3) + 'x (' + row.category_peers + ' peers)'),
        kv('7d momentum adj.', row.growth_multiplier.toFixed(3) + 'x'),
        kv('Maturity adj.', row.maturity_multiplier.toFixed(3) + 'x'),
        kv('Breadth adj.', row.breadth_multiplier.toFixed(3) + 'x'),
        kv('Implied value', fmtMoney(row.implied_value_usd))),
      node('p', { class: 'sub', text: 'The page recomputes this row as ' + fmtMoney(recompute(row)) + (recompute(row) === row.implied_value_usd ? ' \u2014 identical to board.json.' : ' \u2014 differs from board.json; treat the board as stale.') + ' Confidence ' + row.confidence + '/100 (' + row.confidence_tier + '): peer depth, known age, size and breadth. This is a model estimate of what a launch could be worth if the protocol\u2019s record stayed as it is \u2014 not a prediction that a token will launch.' }),
      node('h3', { text: 'Farm plan \u2014 before any launch' }),
      node('ol', { class: 'steps' }, steps),
      node('h3', { text: 'After a launch, if one comes' }),
      node('p', { class: 'sub', text: 'Claim only through the protocol\u2019s official channels, check the contract address against its documentation, and decide your exit before claiming: a common pattern is to sell enough to recover the farming capital and let the rest ride. Never pay a third party a \u201cclaim fee\u201d.' })));
    if (!dialog.isConnected) root.appendChild(dialog);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    renderBoardOnly();
  }
  function renderBoardOnly() {
    var rows = root.querySelectorAll('tbody tr');
    rows.forEach(function (tr) { tr.removeAttribute('data-selected'); });
  }
  function render() {
    var keepDialog = dialog.isConnected && dialog.open;
    root.textContent = '';
    var shell = node('div', { class: 'shell' });
    shell.appendChild(headerBar());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(view.tab === 'board' ? boardPanel() : livePanel());
    if (view.tab === 'board') shell.appendChild(methodPanel());
    shell.appendChild(node('footer', { text: 'Built from the sealed DefiLlama snapshot dated ' + DATA.as_of + ' (' + DATA.source + '). Implied values are this entry\u2019s own model claims. Farming any protocol risks the capital committed; nothing here is financial advice.' }));
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (keepDialog) root.appendChild(dialog);
  }
  // Deep links: #p=<slug> opens a protocol, #category=<name> starts
  // filtered, #q=<text> starts searched. The screenshots use these, and
  // they make any board state shareable as a plain file URL.
  (function applyHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) { render(); return; }
    var params = new URLSearchParams(hash);
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('tier')) view.tier = params.get('tier');
    if (params.get('q')) view.q = params.get('q');
    render();
    if (params.get('p')) openDetail(params.get('p'));
  })();
})();
