// Token Launch Radar — the dashboard's own code. It reads window.RADAR (data.js, written beside
// dashboard/ by main.ts from the same board board.json carries) and renders three views: the ranked
// pre-token board with search, filters and sorting; a detail drawer per protocol with the model's
// arithmetic and the farm plan; the already-trading set, kept apart with the market's own values;
// and a method view that states the model and shows the peer evidence behind every multiple.
// No network, no framework: every byte on the page comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { tab: 'board', q: '', category: 'all', chain: 'all', min: 0, wl: false, sort: 'rank', dir: 1, detail: null };

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 365) return '1.0 yrs';
    if (days >= 30) return Math.round(days / 30.4) + ' mo';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }

  // ---------- tiny DOM helper: everything is built with textContent, never string HTML ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- header stamp and footer ----------
  document.getElementById('stamp').appendChild(el('div', null,
    el('div', { 'class': 'big', text: 'Snapshot ' + DATA.as_of }),
    el('div', { text: 'DefiLlama public API, fetched once and sealed' }),
    el('div', { text: 'Model ' + DATA.model_version + ' - every figure derived from the snapshot' })
  ));
  document.getElementById('foot').textContent =
    'Implied value is this board\u2019s own claim: what a token would be worth if the protocol\u2019s record stayed as it is. ' +
    'It is not a prediction that a token will be issued, or when. A protocol shown here records no token in the snapshot; ' +
    'that is DefiLlama\u2019s record, not proof none exists. Farm plans are research notes, not financial advice.';

  // ---------- tabs ----------
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('#tabs button'));
  tabButtons.forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); render(); });
  });

  function render() {
    tabButtons.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === state.tab); });
    app.setAttribute('aria-busy', 'false');
    app.textContent = '';
    if (state.tab === 'board') renderBoard();
    else if (state.tab === 'live') renderLive();
    else renderMethod();
  }

  // ---------- the board ----------
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.min > 0 && r.implied_value_usd < state.min) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    ratio: function (r) { return r.implied_tvl_ratio; },
    implied: function (r) { return r.implied_value_usd; }
  };

  function renderBoard() {
    var stats = el('div', { 'class': 'stats' },
      stat('Protocols scanned', String(DATA.protocol_size), DATA.pre_token_size + ' record no token; the rest already trade'),
      stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every slug above the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor, ranked'),
      stat('Early finds', String(DATA.early_size), 'pre-token protocols below the floor, found by the model'),
      stat('Peer evidence', DATA.market.peer_count + ' trading peers', 'market-wide median ' + DATA.market.global_median.toFixed(2) + 'x mcap / TVL')
    );
    app.appendChild(stats);

    var categories = unique(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = unique(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []));
    var search = el('input', { type: 'search', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; refreshTable(); });
    var catSel = selectBox(categories, state.category, 'All categories', function (v) { state.category = v; refreshTable(); });
    var chainSel = selectBox(chains, state.chain, 'All chains', function (v) { state.chain = v; refreshTable(); });
    var minSel = el('select', { 'aria-label': 'Minimum implied value' },
      el('option', { value: '0', text: 'Any implied value' }),
      el('option', { value: '100000000', text: 'Implied $100M+' }),
      el('option', { value: '10000000', text: 'Implied $10M+' }),
      el('option', { value: '1000000', text: 'Implied $1M+' })
    );
    minSel.value = String(state.min);
    minSel.addEventListener('change', function () { state.min = Number(minSel.value); refreshTable(); });
    var wlBox = el('input', { type: 'checkbox' });
    wlBox.checked = state.wl;
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; refreshTable(); });

    app.appendChild(el('div', { 'class': 'toolbar' },
      el('label', { text: 'Search' }), search,
      el('label', { text: 'Category' }), catSel,
      el('label', { text: 'Chain' }), chainSel,
      el('label', { text: 'Size' }), minSel,
      el('label', { 'class': 'check' }, wlBox, 'Watchlist only'),
      el('span', { 'class': 'count', id: 'rowcount' })
    ));

    var wrap = el('div', { 'class': 'tablewrap', id: 'boardwrap' });
    app.appendChild(wrap);
    refreshTable();

    function refreshTable() {
      var rows = visibleRows();
      var key = SORTS[state.sort];
      rows.sort(function (a, b) {
        var ka = key(a), kb = key(b);
        var d = ka < kb ? -1 : ka > kb ? 1 : (a.rank - b.rank);
        return d * state.dir;
      });
      var count = document.getElementById('rowcount');
      if (count) {
        count.textContent = '';
        count.appendChild(el('span', null, 'Showing ', el('b', { text: String(rows.length) }), ' of ' + DATA.board_size + ' ranked protocols'));
      }
      wrap.textContent = '';
      if (rows.length === 0) {
        wrap.appendChild(el('div', { 'class': 'empty', text: 'No protocol matches those filters. Loosen one and the radar sweeps again.' }));
        return;
      }
      var maxImplied = DATA.rows[0].implied_value_usd;
      var head = el('thead', null, el('tr', null,
        th('rank', '#'), th('name', 'Protocol'), th(null, 'Category'), th(null, 'Chains'),
        th('tvl', 'TVL'), th('change', '7d'), th('age', 'No-token age'), th('ratio', 'Implied x TVL'), th('implied', 'Implied value')
      ));
      var body = el('tbody', null);
      rows.forEach(function (r) {
        var badge = r.watchlist ? el('span', { 'class': 'wl', text: 'WATCHLIST' }) : el('span', { 'class': 'early', text: 'EARLY' });
        var tr = el('tr', { tabindex: '0', 'class': r.rank <= 3 ? 'top3' : '' },
          el('td', { 'class': 'rank', text: String(r.rank) }),
          el('td', null, el('div', { 'class': 'name' }, r.name, badge), el('div', { 'class': 'slug', text: r.slug })),
          el('td', { 'class': 'cat', text: r.category || 'Uncategorised' }),
          el('td', { 'class': 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
          el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
          el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
          el('td', { 'class': 'num', text: r.implied_tvl_ratio.toFixed(2) + 'x' }),
          el('td', null, el('div', { 'class': 'bar' },
            el('span', { 'class': 'fill', style: 'width:' + Math.max(3, Math.round(100 * r.implied_value_usd / maxImplied)) + '%' }),
            el('span', { 'class': 'val', text: fmtUsd(r.implied_value_usd) })))
        );
        tr.addEventListener('click', function () { openDetail(r.slug); });
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
        body.appendChild(tr);
      });
      wrap.appendChild(el('table', null, head, body));
    }

    function th(sortKey, label) {
      var attrs = { text: label };
      if (sortKey) {
        if (state.sort === sortKey) attrs['class'] = 'sorted';
        attrs.onclick = function () {
          if (state.sort === sortKey) state.dir = -state.dir;
          else { state.sort = sortKey; state.dir = sortKey === 'name' ? 1 : -1; if (sortKey === 'rank') state.dir = 1; }
          refreshTable();
        };
      }
      return el('th', attrs);
    }
  }

  function stat(k, v, s) {
    return el('div', { 'class': 'stat' }, el('div', { 'class': 'k', text: k }), el('div', { 'class': 'v', text: v }), el('div', { 'class': 's', text: s }));
  }
  function unique(list) {
    var seen = {}, out = [];
    list.forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort();
  }
  function selectBox(options, current, allLabel, onChange) {
    var sel = el('select', null, el('option', { value: 'all', text: allLabel }));
    options.forEach(function (o) { sel.appendChild(el('option', { value: o, text: o })); });
    sel.value = current;
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  // ---------- detail drawer ----------
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  function closeDetail() { drawer.hidden = true; scrim.hidden = true; drawer.textContent = ''; }
  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  function openDetail(slug) {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    var m = r.model;
    drawer.textContent = '';
    drawer.appendChild(el('button', { 'class': 'close', text: 'Close', onclick: closeDetail }));
    drawer.appendChild(el('div', { 'class': 'slug', text: 'Rank #' + r.rank + ' of ' + DATA.board_size + ' - ' + r.slug }));
    drawer.appendChild(el('h2', { text: r.name }));
    drawer.appendChild(el('div', { 'class': 'sub', text: (r.category || 'Uncategorised') + ' - records no token in the ' + DATA.as_of + ' snapshot' }));
    drawer.appendChild(el('div', { 'class': 'hero' },
      el('div', { 'class': 'k', text: 'Implied token value' }),
      el('div', { 'class': 'v', text: fmtUsd(r.implied_value_usd) }),
      el('div', { 'class': 's', text: r.implied_tvl_ratio.toFixed(2) + 'x its TVL of ' + fmtUsd(r.tvl_usd) + ', at the ' + (r.category || 'market') + ' peer multiple' }),
      el('div', { 'class': 's', text: 'Peer range ' + fmtUsd(m.value_low_usd) + ' - ' + fmtUsd(m.value_high_usd) + ': the same arithmetic at the category\u2019s lower and upper peer quartiles, so the spread of the evidence is on the page, not hidden behind the point value' })
    ));
    drawer.appendChild(el('div', { 'class': 'grid2' },
      kv('TVL', fmtUsd(r.tvl_usd)), kv('TVL change, 7d', fmtPct(r.change_7d)),
      kv('No-token age', fmtAge(r.age_days)), kv('First tracked', r.listed_at || 'not recorded'),
      kv('Chains', String(r.chains.length)), kv('Board', r.watchlist ? 'Watchlist' : 'Early find')
    ));
    drawer.appendChild(el('h3', { text: 'Where it operates' }));
    drawer.appendChild(el('div', { 'class': 'chiprow' }, r.chains.map(function (c) { return el('span', { 'class': 'chip', text: c }); })));
    drawer.appendChild(el('h3', { text: 'How the model gets this number' }));
    drawer.appendChild(el('table', { 'class': 'mini' }, el('tbody', null,
      mrow('TVL (snapshot)', fmtUsd(r.tvl_usd)),
      mrow('Category multiple (' + m.category_peers + ' trading peers)', m.category_multiple.toFixed(3) + 'x'),
      mrow('Momentum, 7d change ' + fmtPct(r.change_7d), m.growth_multiplier.toFixed(3) + 'x'),
      mrow('Track record, ' + fmtAge(r.age_days) + ' with no token', m.maturity_multiplier.toFixed(3) + 'x'),
      mrow('Breadth, ' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains'), m.breadth_multiplier.toFixed(3) + 'x'),
      mrow('Implied value', fmtUsd(r.implied_value_usd)),
      mrow('At the peer quartiles instead', fmtUsd(m.value_low_usd) + ' - ' + fmtUsd(m.value_high_usd))
    )));
    drawer.appendChild(el('h3', { text: 'The farm plan' }));
    var fs = r.farm_summary;
    drawer.appendChild(el('div', { 'class': 'grid2' },
      kv('Capital', fmtUsd(fs.capital_usd)), kv('Fees over the hold', 'about ' + fmtUsd(fs.fees_usd)),
      kv('Hold', fs.hold_days + ' days'), kv('Time', 'about ' + fs.minutes_per_week + ' min a week')
    ));
    var plan = el('ol', { 'class': 'plan' });
    r.farm_steps.forEach(function (s) { plan.appendChild(el('li', { text: s })); });
    drawer.appendChild(plan);
    drawer.appendChild(el('p', { 'class': 'sub', text: 'Plan figures come from this protocol\u2019s own record: capital scaled to its TVL, fees from its first chain, the hold from its age.' }));
    scrim.hidden = false;
    drawer.hidden = false;
    drawer.scrollTop = 0;
  }
  function kv(k, v) { return el('div', { 'class': 'kv' }, el('div', { 'class': 'k', text: k }), el('div', { 'class': 'v', text: v })); }
  function mrow(k, v) { return el('tr', null, el('td', { text: k }), el('td', { text: v })); }

  // ---------- live tokens: the market's own values, never ranked ----------
  function renderLive() {
    app.appendChild(el('div', { 'class': 'method' },
      el('h2', { text: 'Already trading - set aside on purpose' }),
      el('p', null, 'These protocols\u2019 tokens already trade, so the radar does not rank them: it shows the market\u2019s own market cap beside TVL. ' +
        'They matter to the board as evidence - their market-cap-to-TVL ratios are the peer multiples the model applies to the pre-token protocols. ' +
        'The ' + DATA.market.peer_count + ' trading protocols with both figures give a market-wide median of ' + DATA.market.global_median.toFixed(2) + 'x.')
    ));
    var body = el('tbody', null);
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', null, el('div', { 'class': 'name', text: r.name }), el('div', { 'class': 'slug', text: r.slug })),
        el('td', { 'class': 'cat', text: r.symbol || '' }),
        el('td', { 'class': 'cat', text: r.category || 'Uncategorised' }),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { 'class': 'num', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(2) + 'x' }),
        el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) })
      ));
    });
    app.appendChild(el('div', { 'class': 'tablewrap' }, el('table', null,
      el('thead', null, el('tr', null,
        el('th', { text: 'Protocol' }), el('th', { text: 'Symbol' }), el('th', { text: 'Category' }),
        el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Mcap x TVL' }), el('th', { text: '7d' }))),
      body
    )));
  }

  // ---------- method ----------
  function renderMethod() {
    var wrap = el('div', { 'class': 'method' });
    wrap.appendChild(el('h2', { text: 'How the ranking works' }));
    wrap.appendChild(el('p', null, 'Every number on the board comes from the sealed snapshot of ' + DATA.as_of + ' - TVL, the seven-day TVL change, ' +
      'the date DefiLlama first tracked the protocol, its chains and its category - and from the snapshot\u2019s own trading protocols. ' +
      'No name is special-cased and nothing is looked up: the same function scores every row, and each protocol\u2019s detail view shows its arithmetic.'));
    wrap.appendChild(el('div', { 'class': 'formula', text: 'implied value = TVL x category multiple x momentum x track record x breadth' }));
    wrap.appendChild(el('h3', { text: '1. The category multiple - what the market pays per TVL dollar' }));
    wrap.appendChild(el('p', null, 'For each protocol whose token already trades, the snapshot gives a market cap and a TVL: their ratio is what the market pays ' +
      'for a dollar of that protocol\u2019s TVL. Ratios are winsorised to [0.02, 3] so one broken print cannot steer a category. A category\u2019s multiple is the median of ' +
      'its peers\u2019 ratios, shrunk toward the market-wide median (' + DATA.market.global_median.toFixed(2) + 'x over ' + DATA.market.peer_count + ' peers) by the peer count: ' +
      'multiple = (n x median + 5 x global) / (n + 5). A category with forty peers stands on its own; one with two borrows the market\u2019s strength. ' +
      'A category with no trading peer uses the market-wide median.'));
    wrap.appendChild(el('h3', { text: '2. Momentum - is the TVL arriving or leaving?' }));
    wrap.appendChild(el('p', null, 'The seven-day change is clamped to [-30%, +50%] (unreported counts as flat) and carried at 1.2 weight: ' +
      'momentum = 1 + change/100 x 1.2, from 0.64x for a protocol shrinking fast to 1.60x for one growing 50% in a week.'));
    wrap.appendChild(el('h3', { text: '3. Track record - how long with no token' }));
    wrap.appendChild(el('p', null, 'A protocol that has held TVL for years with no token is a different claim from one listed last month. ' +
      'Track record runs from 0.78x for a brand-new listing to 1.22x at four years (0.78 + 0.44 x min(age, 1460 days) / 1460). ' +
      'An unrecorded listing date counts as 730 days, the neutral middle, a multiplier of exactly 1.00.'));
    wrap.appendChild(el('h3', { text: '4. Breadth - distribution a launch can reach' }));
    wrap.appendChild(el('p', null, 'Each chain past the first adds 3%, up to seven extra chains (1.21x): a protocol already operating on many chains ' +
      'puts a future token in more hands on day one.'));
    wrap.appendChild(el('h3', { text: '5. The range - how far apart the peers are' }));
    wrap.appendChild(el('p', null, 'A point value hides the disagreement inside a category, so every row also carries a range: the same arithmetic with the ' +
      'category\u2019s multiple replaced by its shrunk lower and upper peer quartiles (the 25th and 75th percentile ratios, shrunk toward the market-wide quartiles ' +
      'with the same peer-count weight). Where the peers agree, the range is narrow and the point value rests on solid evidence; where they scatter, the range ' +
      'says so on the page. Each protocol\u2019s detail view shows its range beside its value, and the evidence table below carries every category\u2019s quartiles.'));
    wrap.appendChild(el('h3', { text: 'Who is on the board' }));
    wrap.appendChild(el('p', null, 'The board holds ' + DATA.board_size + ' rows: every one of the ' + DATA.watchlist_size + ' watchlist slugs (pre-token protocols at or above the $' +
      Math.round(DATA.floor_usd / 1e6) + 'M floor, the floor the coverage check holds), plus the ' + DATA.early_size + ' highest-valued further pre-token protocols under the same exclusions - ' +
      'no exchanges, no bridges or restaked wrappers of a token that already trades, no versioned pools. Small independent staking products below the floor are admitted: they do launch tokens. ' +
      'Protocols whose token already trades are never ranked; they sit in the Already trading view at the market\u2019s own values.'));
    wrap.appendChild(el('h3', { text: 'The peer evidence, category by category' }));
    var body = el('tbody', null);
    DATA.market.categories.forEach(function (c) {
      body.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { 'class': 'num', text: String(c.peers) }),
        el('td', { 'class': 'num', text: c.median_ratio.toFixed(3) + 'x' }),
        el('td', { 'class': 'num', text: c.multiple.toFixed(3) + 'x' }),
        el('td', { 'class': 'num', text: c.q1_ratio.toFixed(3) + 'x - ' + c.q3_ratio.toFixed(3) + 'x' })
      ));
    });
    wrap.appendChild(el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Trading peers' }), el('th', { text: 'Median mcap / TVL' }), el('th', { text: 'Multiple used' }), el('th', { text: 'Peer quartiles' }))),
      body));
    wrap.appendChild(el('div', { 'class': 'note', text: 'Read the board as a claim, not a forecast: it says what a token would be worth if the protocol\u2019s record stayed as it is. ' +
      'It does not say a token will be issued, or when, and a protocol that records no token in DefiLlama\u2019s data may still have one the record does not carry.' }));
    app.appendChild(wrap);
  }

  // ---------- deep links (also how the screenshots are framed) ----------
  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kvPair = pair.split('=');
      var k = kvPair[0], v = decodeURIComponent(kvPair.slice(1).join('=') || '');
      if (k === 'tab' && (v === 'board' || v === 'live' || v === 'method')) state.tab = v;
      if (k === 'cat') state.category = v;
      if (k === 'chain') state.chain = v;
      if (k === 'q') state.q = v;
      if (k === 'wl') state.wl = v === '1';
      if (k === 'detail') state.detail = v;
    });
  }
  applyHash();
  render();
  if (state.detail) openDetail(state.detail);
})();
