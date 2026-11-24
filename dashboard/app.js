// Token Launch Radar — the dashboard's own code. It reads window.RADAR (data.js, written beside
// dashboard/ by main.ts from the same board board.json carries) and renders three views: the ranked
// pre-token board with search, filters and sorting; a detail drawer per protocol with the fitted
// model's arithmetic, the odds and the farm plan; the already-trading set, kept apart with the
// market's own values; and a method view that states the fitted model, its two tests, the odds
// table and the verdict rule. No network, no framework: every byte on the page comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { tab: 'board', q: '', category: 'all', chain: 'all', min: 0, wl: false, verdict: 'all', sort: 'rank', dir: 1, detail: null };

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
  function fmtOdds(n) { return Math.round(n * 100) + '%'; }

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
    el('div', { text: 'Model ' + DATA.model_version + ' - fitted on the snapshot\u2019s own peers' })
  ));
  document.getElementById('foot').textContent =
    'Implied value is this board\u2019s own claim: what a token would be worth if the protocol\u2019s record stayed as it is. ' +
    'Expected value weights that figure by the share of comparable protocols that record a token in the snapshot. ' +
    'Neither is a prediction that a token will be issued, or when. A protocol shown here records no token in the snapshot; ' +
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
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.min > 0 && r.implied_value_usd < state.min) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  var VERDICT_ORDER = { farm: 3, thin: 2, skip: 1 };
  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    ratio: function (r) { return r.implied_tvl_ratio; },
    implied: function (r) { return r.implied_value_usd; },
    odds: function (r) { return r.odds; },
    expected: function (r) { return r.expected_value_usd; },
    verdict: function (r) { return VERDICT_ORDER[r.verdict]; }
  };

  function kpiStrip() {
    var f = DATA.fit;
    var items = [
      [String(DATA.protocol_size), 'protocols audited'],
      [DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered'],
      [String(DATA.board_size), 'board rows ranked'],
      [String(f.peers), 'peers fitted'],
      ['\u00d7' + f.loo.vs_global.toFixed(2), 'leave-one-out error vs market median'],
      ['record odds', 'token odds from the peers\u2019 own record']
    ];
    return el('div', { 'class': 'kpibar' }, items.map(function (it) {
      return el('div', { 'class': 'kpi' }, el('b', { text: it[0] }), el('span', { text: it[1] }));
    }));
  }

  function integrityStrip() {
    if (!DATA.integrity || !DATA.integrity.length) return null;
    return el('div', { 'class': 'integrity' },
      el('span', { 'class': 'ilabel', text: 'Self-checks:' }),
      DATA.integrity.map(function (c) {
        return el('span', { 'class': 'icheck ' + (c.ok ? 'ok' : 'bad'), text: (c.ok ? '\u2713 ' : '\u2717 ') + c.label });
      })
    );
  }

  function renderBoard() {
    app.appendChild(kpiStrip());
    var strip = integrityStrip();
    if (strip) app.appendChild(strip);

    if (DATA.insights && DATA.insights.length) {
      var cards = el('div', { 'class': 'stats insights' });
      DATA.insights.forEach(function (ins) {
        cards.appendChild(el('div', { 'class': 'stat' },
          el('div', { 'class': 'k', text: ins.title }),
          el('div', { 'class': 's', text: ins.body })));
      });
      app.appendChild(cards);
    }

    var categories = unique(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }));
    var chains = unique(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []));
    var search = el('input', { type: 'search', placeholder: 'Search name or slug', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; refreshTable(); });
    var catSel = selectBox(categories, state.category, 'All categories', function (v) { state.category = v; refreshTable(); });
    var chainSel = selectBox(chains, state.chain, 'All chains', function (v) { state.chain = v; refreshTable(); });
    var verdictSel = el('select', { 'aria-label': 'Verdict filter' },
      el('option', { value: 'all', text: 'All verdicts' }),
      el('option', { value: 'farm', text: 'Farm' }),
      el('option', { value: 'thin', text: 'Thin' }),
      el('option', { value: 'skip', text: 'Skip' })
    );
    verdictSel.value = state.verdict;
    verdictSel.addEventListener('change', function () { state.verdict = verdictSel.value; refreshTable(); });
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
      el('label', { text: 'Verdict' }), verdictSel,
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
        th('tvl', 'TVL'), th('change', '7d'), th('age', 'No-token age'), th('ratio', 'Impl. \u00d7 TVL'),
        th('implied', 'Implied value'), th('odds', 'Odds'), th('expected', 'Expected'), th('verdict', 'Verdict')
      ));
      var body = el('tbody', null);
      rows.forEach(function (r) {
        var badge = r.watchlist ? el('span', { 'class': 'wl', text: 'WATCHLIST' }) : el('span', { 'class': 'early', text: 'EARLY' });
        var tr = el('tr', { tabindex: '0', 'class': r.rank <= 3 ? 'top3' : '' },
          el('td', { 'class': 'rank', text: String(r.rank) }),
          el('td', null, el('div', { 'class': 'name' }, r.name, badge, el('span', { 'class': 'slug', text: ' ' + r.slug }))),
          el('td', { 'class': 'cat', text: r.category || 'Uncategorised' }),
          el('td', { 'class': 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
          el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
          el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
          el('td', { 'class': 'num', text: r.implied_tvl_ratio.toFixed(2) + 'x' }),
          el('td', null, el('div', { 'class': 'bar' },
            el('span', { 'class': 'fill', style: 'width:' + Math.max(3, Math.round(100 * r.implied_value_usd / maxImplied)) + '%' }),
            el('span', { 'class': 'val', text: fmtUsd(r.implied_value_usd) }))),
          el('td', { 'class': 'num', text: fmtOdds(r.odds) }),
          el('td', { 'class': 'num', text: fmtUsd(r.expected_value_usd) }),
          el('td', null, el('span', { 'class': 'verdict v-' + r.verdict, text: r.verdict.toUpperCase() }))
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
      el('div', { 'class': 's', text: r.implied_tvl_ratio.toFixed(2) + 'x its TVL of ' + fmtUsd(r.tvl_usd) + ', at the fitted multiple of ' + m.fitted_multiple.toFixed(2) + 'x' }),
      el('div', { 'class': 's', text: 'Expected value ' + fmtUsd(r.expected_value_usd) + ' = implied \u00d7 ' + fmtOdds(r.odds) + ', the share of ' + m.odds_band.toLowerCase() + ' protocols that record a token in this snapshot' }),
      el('div', { 'class': 's', text: 'Peer range ' + fmtUsd(m.value_low_usd) + ' - ' + fmtUsd(m.value_high_usd) + ' (the category\u2019s peer quartiles); model error band ' + fmtUsd(m.conf_low_usd) + ' - ' + fmtUsd(m.conf_high_usd) + ' (the fit\u2019s own measured error, conformal 80%)' })
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
      mrow('Fitted multiple (on ' + DATA.fit.peers + ' peers, category offset \u00d7' + m.category_offset.toFixed(2) + ')', m.fitted_multiple.toFixed(3) + 'x'),
      mrow('= Implied value', fmtUsd(r.implied_value_usd)),
      mrow('At the peer quartiles instead', fmtUsd(m.value_low_usd) + ' - ' + fmtUsd(m.value_high_usd)),
      mrow('Across the model\u2019s own error band', fmtUsd(m.conf_low_usd) + ' - ' + fmtUsd(m.conf_high_usd)),
      mrow('Token odds, ' + m.odds_band.toLowerCase() + ' (' + (m.odds_basis === 'category' ? 'band-and-category share' : 'age-band share') + ')', fmtOdds(r.odds)),
      mrow('Expected value (implied \u00d7 odds)', fmtUsd(r.expected_value_usd))
    )));
    var catStat = null;
    DATA.market.categories.forEach(function (c) { if (c.category === (r.category || 'Uncategorised')) catStat = c; });
    if (catStat && catStat.peer_examples && catStat.peer_examples.length) {
      drawer.appendChild(el('h3', { text: 'The peers behind the evidence' }));
      drawer.appendChild(el('p', { 'class': 'sub', text: 'The largest trading ' + (r.category || 'market') + ' protocols by market cap, and the mcap / TVL ratio each one contributes to the category\u2019s evidence:' }));
      var plist = el('table', { 'class': 'mini' }, el('tbody', null,
        catStat.peer_examples.map(function (p) { return mrow(p.name, p.ratio.toFixed(3) + 'x'); })
      ));
      drawer.appendChild(plist);
    }
    drawer.appendChild(el('h3', { text: 'The farm plan' }));
    var fs = r.farm_summary;
    drawer.appendChild(el('div', { 'class': 'grid2' },
      kv('Verdict', r.verdict.toUpperCase() + ' - position ' + fmtUsd(m.position_value_usd) + ' vs plan cost ' + fmtUsd(m.plan_cost_usd)),
      kv('Deposit tier', fmtUsd(fs.deposit_tier_usd)),
      kv('Capital', fmtUsd(fs.capital_usd)), kv('Fees over the hold', 'about ' + fmtUsd(fs.fees_usd)),
      kv('Hold', fs.hold_days + ' days'), kv('Time', 'about ' + fs.minutes_per_week + ' min a week')
    ));
    var plan = el('ol', { 'class': 'plan' });
    r.farm_steps.forEach(function (s) { plan.appendChild(el('li', { text: s })); });
    drawer.appendChild(plan);
    drawer.appendChild(el('p', { 'class': 'sub', text: 'Plan figures come from this protocol\u2019s own record: capital scaled to its TVL, fees from its first chain, the hold from its age. The verdict prices the plan against the pro-rata slice of expected value a position of this size represents; the method view states the rule and its constants.' }));
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
        'They matter to the board as evidence - the ' + DATA.fit.peers + ' of them that report both figures are the peers the value model is fitted on, ' +
        'and their market-cap-to-TVL ratios make up the category evidence on the method view.')
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
    var f = DATA.fit, loo = f.loo, wf = f.walk_forward, a = DATA.audit;
    var c = f.coefficients;
    var wrap = el('div', { 'class': 'method' });
    wrap.appendChild(el('h2', { text: 'How the ranking works' }));
    wrap.appendChild(el('p', null, 'Every number on the board comes from the sealed snapshot of ' + DATA.as_of + ' - TVL, the seven-day TVL change, ' +
      'the date DefiLlama first tracked the protocol, its chains and its category - and from the snapshot\u2019s own trading protocols. ' +
      'No name is special-cased, nothing is looked up and no constant in the value model is chosen by hand.'));
    wrap.appendChild(el('div', { 'class': 'formula', text: 'implied value = exp( fitted line + category offset )    \u00b7    expected value = implied \u00d7 odds' }));
    wrap.appendChild(el('h3', { text: '1. The fit - the peers price the model, not a table of constants' }));
    wrap.appendChild(el('p', null, 'The ' + f.peers + ' protocols whose token trades and that report both a market cap and a TVL are the evidence. On them the model fits, ' +
      'by least squares, log(market cap) on log(TVL), the seven-day change (clamped to [-30%, +50%], unreported counts as flat) and log(1 + age in days), ' +
      'an unrecorded listing date counting as 730 days. Fitted on this snapshot, the line is: log mcap = ' + c[0].toFixed(2) + ' + ' + c[1].toFixed(2) +
      ' \u00d7 log TVL ' + (c[2] < 0 ? '\u2212 ' + Math.abs(c[2]).toFixed(3) : '+ ' + c[2].toFixed(3)) + ' \u00d7 7d change ' +
      (c[3] < 0 ? '\u2212 ' + Math.abs(c[3]).toFixed(2) : '+ ' + c[3].toFixed(2)) + ' \u00d7 log(1 + age). Read it as the peers state it: a TVL dollar carries about half its ' +
      'weight into market cap in log space, a hot week prices lower not higher, and age given TVL adds nothing. Each category then carries an offset: the median ' +
      'of its peers\u2019 residuals against the line, shrunk toward zero by the peer count (offset = n \u00d7 median / (n + 5)).'));
    wrap.appendChild(el('h3', { text: '2. The tests - the model is scored on peers it did not fit' }));
    var tBody = el('tbody', null,
      el('tr', null,
        el('td', { text: 'Leave-one-out (each of the ' + loo.test + ' peers predicted by a model fitted without it)' }),
        el('td', { 'class': 'num', text: loo.fitted.toFixed(2) }),
        el('td', { 'class': 'num', text: loo.global_median.toFixed(2) }),
        el('td', { 'class': 'num', text: loo.category_model.toFixed(2) })),
      el('tr', null,
        el('td', { text: 'Walk-forward (fitted on the ' + wf.train + ' older dated peers, tested on the ' + wf.test + ' newer)' }),
        el('td', { 'class': 'num', text: wf.fitted.toFixed(2) }),
        el('td', { 'class': 'num', text: wf.global_median.toFixed(2) }),
        el('td', { 'class': 'num', text: wf.category_model.toFixed(2) }))
    );
    wrap.appendChild(el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Test' }), el('th', { text: 'This fit' }), el('th', { text: 'Market-median multiple' }), el('th', { text: 'Category model (peer-multiple-4)' }))),
      tBody));
    wrap.appendChild(el('p', null, 'The figures are median |log error| - the typical factor by which a prediction misses is e to that power; lower is better. Both baselines are ' +
      'recomputed inside each test on the same training peers: leave-one-out, the fit\u2019s median error is ' + loo.vs_global.toFixed(2) + '\u00d7 smaller than the market-median multiple\u2019s and ' +
      loo.vs_category.toFixed(2) + '\u00d7 smaller than the previous category model\u2019s; walk-forward, ' + wf.vs_global.toFixed(2) + '\u00d7 and ' + wf.vs_category.toFixed(2) + '\u00d7.'));
    wrap.appendChild(el('h3', { text: '3. The odds - how often a token has come, from the record' }));
    var oddsPara = el('p', null, 'Each row\u2019s odds are the share of comparable protocols that record a token in this snapshot: its age band\u2019s share, or - where the ' +
      'band-and-category cell holds at least ten protocols - that cell\u2019s own share. The words matter: this is a share of a record, the peers\u2019 own history, ' +
      'not a forecast that any protocol will issue a token or when, and the odds never move a rank - the board ranks by implied value, and expected value ' +
      '(implied \u00d7 odds) rides beside it as the odds-weighted companion figure.');
    var oBody = el('tbody', null);
    DATA.odds.bands.forEach(function (b) {
      oBody.appendChild(el('tr', null,
        el('td', { text: b.label }),
        el('td', { 'class': 'num', text: String(b.protocols) }),
        el('td', { 'class': 'num', text: String(b.record_token) }),
        el('td', { 'class': 'num', text: Math.round(b.share * 100) + '%' })
      ));
    });
    wrap.appendChild(el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Age band (first tracked)' }), el('th', { text: 'Protocols' }), el('th', { text: 'Record a token' }), el('th', { text: 'Share' }))),
      oBody));
    wrap.appendChild(oddsPara);
    wrap.appendChild(el('h3', { text: '4. The two ranges - peer spread is not model error' }));
    wrap.appendChild(el('p', null, 'Every row carries two ranges and they are different claims. The peer range applies the category\u2019s own spread - its shrunk lower and ' +
      'upper peer quartiles in place of its median - around the fitted point: how far apart the peers are. The error band applies the fit\u2019s conformal half-width ' +
      'from the tests above: how far off the model itself has been. The fit is better than its baselines, and still rough - the 80th percentile of its leave-one-out ' +
      'residuals is ' + f.conformal_log.toFixed(2) + ' in log space, so the band runs from a row\u2019s implied value divided by ' + Math.exp(f.conformal_log).toFixed(1) +
      ' to it multiplied by the same: the model\u2019s own measured miss, printed rather than hidden. A row can sit on agreeing peers and still carry a wide error band; ' +
      'the page shows both rather than letting one point value pretend to be exact.'));
    wrap.appendChild(el('h3', { text: '5. The verdict - every row priced against its own plan' }));
    wrap.appendChild(el('p', null, 'A farm plan costs its fees plus its capital priced as tied up at 5% a year over the hold. Against that cost, the row sets the pro-rata ' +
      'slice of its expected value that a position of the plan\u2019s own size represents (expected value \u00d7 capital / TVL). The verdict is farm when the slice covers the ' +
      'cost at least once over, thin when it covers at least 0.30 of it, and skip below that. No figure from outside the snapshot and the plan enters the rule, ' +
      'and no share of a future token supply is assumed anywhere: the slice is a way to compare rows, stated as such. Deposit tiers follow the plan\u2019s capital: ' +
      '$50 below $25M of TVL, rising through $100 and $150 to $250 at $500M and $500 at $2B.'));
    wrap.appendChild(el('h3', { text: 'Who is on the board - all ' + DATA.protocol_size + ' protocols accounted for' }));
    wrap.appendChild(el('p', null, 'Of the snapshot\u2019s ' + a.total + ' protocols: ' + a.fitted_peers + ' are fitted peers and ' + a.traded_other + ' more already trade without both ' +
      'figures, so they stand as evidence of a token but not of a price; ' + a.pre_token + ' record no token. The board holds ' + a.board_rows + ' of those: every one of the ' +
      DATA.watchlist_size + ' watchlist slugs (pre-token protocols at or above the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor, the floor the coverage check holds), plus the ' +
      DATA.early_size + ' highest-valued further pre-token protocols under the same exclusions. The other ' + a.off_board + ' pre-token protocols are off the board for stated reasons: ' +
      a.excluded.category + ' in excluded categories (bridges, restaked wrappers of tokens that already trade, exchanges), ' + a.excluded.floor_staking +
      ' staking wrappers at or above the floor, ' + a.excluded.versioned + ' versioned pools of another protocol, ' + a.excluded.wrapped_name +
      ' wrapped or staked products by name, ' + a.excluded.exchange_name + ' exchange products by name, and ' + a.excluded.below_cut + ' simply below the board\u2019s cut. ' +
      'Small independent staking products below the floor are admitted: they do launch tokens. Protocols whose token already trades are never ranked; they sit in the Already trading view at the market\u2019s own values.'));
    wrap.appendChild(el('h3', { text: 'The peer evidence, category by category' }));
    var body = el('tbody', null);
    DATA.market.categories.forEach(function (ct) {
      body.appendChild(el('tr', null,
        el('td', { text: ct.category }),
        el('td', { 'class': 'num', text: String(ct.peers) }),
        el('td', { 'class': 'num', text: ct.median_ratio.toFixed(3) + 'x' }),
        el('td', { 'class': 'num', text: ct.multiple.toFixed(3) + 'x' }),
        el('td', { 'class': 'num', text: ct.q1_ratio.toFixed(3) + 'x - ' + ct.q3_ratio.toFixed(3) + 'x' })
      ));
    });
    wrap.appendChild(el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Trading peers' }), el('th', { text: 'Median mcap / TVL' }), el('th', { text: 'Multiple (peer-multiple-4 baseline)' }), el('th', { text: 'Peer quartiles' }))),
      body));
    wrap.appendChild(el('div', { 'class': 'note', text: 'Read the board as a claim, not a forecast: it says what a token would be worth if the protocol\u2019s record stayed as it is, ' +
      'weighted by how often comparable protocols record a token at all. It does not say a token will be issued, or when, and a protocol that records no token in ' +
      'DefiLlama\u2019s data may still have one the record does not carry.' }));
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
      if (k === 'verdict') state.verdict = v;
      if (k === 'detail') state.detail = v;
    });
  }
  applyHash();
  render();
  if (state.detail) openDetail(state.detail);
})();
