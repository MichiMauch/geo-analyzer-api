// Self-contained private dashboard page served at GET /dashboard.
// No build step, no framework: one HTML string with inline CSS and a small
// vanilla-JS client that fetches /v1/stats and /v1/stats/history and renders
// KPIs, a history chart (Chart.js via CDN), rating distribution, category
// averages and top recommendations. Intentionally unauthenticated for now —
// the data is the same anonymous aggregate that /v1/stats already exposes.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Paul AI GEO Analyzer — Statistik</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root { --teal:#0d9488; --teal-d:#0f766e; --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --bg:#f8fafc; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { background:linear-gradient(90deg,var(--teal),var(--teal-d)); color:#fff; padding:20px 24px; }
  header h1 { margin:0; font-size:20px; font-weight:700; }
  header .sub { opacity:.85; font-size:13px; margin-top:2px; }
  main { max-width:1040px; margin:0 auto; padding:24px; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-bottom:20px; }
  .kpi { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; }
  .kpi .v { font-size:30px; font-weight:700; color:var(--teal-d); line-height:1; }
  .kpi .l { font-size:12px; color:var(--muted); margin-top:6px; text-transform:uppercase; letter-spacing:.03em; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:20px; }
  .card h2 { margin:0 0 14px; font-size:15px; font-weight:600; }
  .card-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .card-head h2 { margin:0; }
  .ranges button { border:1px solid var(--line); background:#fff; color:var(--muted); border-radius:8px; padding:5px 11px; font-size:13px; cursor:pointer; margin-left:6px; }
  .ranges button.active { background:var(--teal); border-color:var(--teal); color:#fff; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width:720px){ .grid { grid-template-columns:1fr; } }
  .bar-row { display:grid; grid-template-columns:140px 1fr 64px; align-items:center; gap:10px; margin:7px 0; font-size:13px; }
  .bar-row .name { color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { background:#f1f5f9; border-radius:6px; height:16px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:6px; background:var(--teal); }
  .bar-row .val { text-align:right; color:var(--muted); font-variant-numeric:tabular-nums; }
  .updated { font-size:12px; color:var(--muted); margin-top:6px; }
  canvas { max-height:300px; }
  .err { color:#b91c1c; }
</style>
</head>
<body>
<header>
  <h1>Paul AI GEO Analyzer — Statistik</h1>
  <div class="sub">Anonyme Nutzungsstatistik · privat</div>
</header>
<main>
  <section class="kpis" id="kpis"></section>

  <section class="card">
    <div class="card-head">
      <h2>Verlauf</h2>
      <div class="ranges" id="ranges">
        <button data-days="30">30 T</button>
        <button data-days="90" class="active">90 T</button>
        <button data-days="365">1 J</button>
      </div>
    </div>
    <canvas id="histChart"></canvas>
  </section>

  <div class="grid">
    <section class="card"><h2>Bewertungsverteilung</h2><div id="ratings"></div></section>
    <section class="card"><h2>Kategorie-Durchschnitt (0–5)</h2><div id="cats"></div></section>
  </div>

  <section class="card">
    <h2>Häufigste Empfehlungen</h2>
    <div id="recs"></div>
  </section>

  <div class="updated" id="updated"></div>
</main>

<script>
  var CAT_LABELS = {
    contentClarity: 'Inhaltliche Klarheit',
    answerability: 'Beantwortbarkeit',
    trustSources: 'Vertrauen & Quellen',
    machineReadability: 'Maschinenlesbarkeit',
    aiCitation: 'KI-Zitierbarkeit',
    onPageSeo: 'On-Page-SEO'
  };
  var RATING_ORDER = ['poor','moderate','good','excellent'];
  var RATING_LABELS = { poor:'Kritisch', moderate:'Mittel', good:'Gut', excellent:'Exzellent' };
  var RATING_COLORS = { poor:'#ef4444', moderate:'#eab308', good:'#84cc16', excellent:'#22c55e' };

  function el(id){ return document.getElementById(id); }
  function pretty(key){ return key.replace(/_/g,' ').replace(/^./, function(c){ return c.toUpperCase(); }); }
  function barRow(name, pct, val, color){
    var row = document.createElement('div'); row.className = 'bar-row';
    var n = document.createElement('div'); n.className = 'name'; n.textContent = name; n.title = name;
    var track = document.createElement('div'); track.className = 'bar-track';
    var fill = document.createElement('div'); fill.className = 'bar-fill';
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (color) fill.style.background = color;
    track.appendChild(fill);
    var v = document.createElement('div'); v.className = 'val'; v.textContent = val;
    row.appendChild(n); row.appendChild(track); row.appendChild(v);
    return row;
  }

  function renderKpis(s){
    var tiles = [
      { v: s.totalAnalyses, l: 'Analysen gesamt' },
      { v: s.avgScore + ' / ' + s.maxScore, l: 'Ø Score' },
      { v: s.uniqueInstalls, l: 'Installationen' }
    ];
    var box = el('kpis'); box.innerHTML = '';
    tiles.forEach(function(t){
      var d = document.createElement('div'); d.className = 'kpi';
      var v = document.createElement('div'); v.className = 'v'; v.textContent = t.v;
      var l = document.createElement('div'); l.className = 'l'; l.textContent = t.l;
      d.appendChild(v); d.appendChild(l); box.appendChild(d);
    });
  }

  function renderRatings(s){
    var box = el('ratings'); box.innerHTML = '';
    var total = 0; RATING_ORDER.forEach(function(k){ total += (s.ratingDistribution[k] || 0); });
    RATING_ORDER.forEach(function(k){
      var n = s.ratingDistribution[k] || 0;
      var pct = total > 0 ? (n/total*100) : 0;
      box.appendChild(barRow(RATING_LABELS[k], pct, n + ' (' + Math.round(pct) + '%)', RATING_COLORS[k]));
    });
  }

  function renderCats(s){
    var box = el('cats'); box.innerHTML = '';
    Object.keys(s.categoryAverages).sort(function(a,b){ return s.categoryAverages[a]-s.categoryAverages[b]; })
      .forEach(function(k){
        var avg = s.categoryAverages[k];
        box.appendChild(barRow(CAT_LABELS[k] || k, avg/5*100, avg.toFixed(1)));
      });
  }

  function renderRecs(s){
    var box = el('recs'); box.innerHTML = '';
    s.topRecommendations.forEach(function(r){
      box.appendChild(barRow(pretty(r.key), r.pct, r.count + ' (' + r.pct + '%)'));
    });
  }

  var chart = null;
  function renderHistory(points){
    var labels = points.map(function(p){ var d = p.day.slice(5).split('-'); return d[1] + '.' + d[0]; });
    var analyses = points.map(function(p){ return p.analyses; });
    var avg = points.map(function(p){ return p.avgScore; });
    var ctx = el('histChart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      data: {
        labels: labels,
        datasets: [
          { type:'bar', label:'Analysen/Tag', data:analyses, backgroundColor:'rgba(13,148,136,.35)', borderColor:'#0d9488', borderWidth:1, yAxisID:'y' },
          { type:'line', label:'Ø Score', data:avg, borderColor:'#f59e0b', backgroundColor:'#f59e0b', tension:.3, spanGaps:true, yAxisID:'y1', pointRadius:2 }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false },
        scales: {
          y:{ beginAtZero:true, position:'left', title:{ display:true, text:'Analysen' } },
          y1:{ beginAtZero:true, max:30, position:'right', grid:{ drawOnChartArea:false }, title:{ display:true, text:'Ø Score' } }
        }
      }
    });
  }

  function loadHistory(days){
    fetch('/v1/stats/history?days=' + days).then(function(r){ return r.json(); })
      .then(function(d){ renderHistory(d.points || []); })
      .catch(function(){ el('histChart').replaceWith(Object.assign(document.createElement('p'),{className:'err',textContent:'Verlauf konnte nicht geladen werden.'})); });
  }

  fetch('/v1/stats').then(function(r){ return r.json(); }).then(function(s){
    renderKpis(s); renderRatings(s); renderCats(s); renderRecs(s);
    el('updated').textContent = 'Stand: ' + new Date(s.updatedAt).toLocaleString('de-CH');
  }).catch(function(){ el('kpis').innerHTML = '<p class="err">Statistik konnte nicht geladen werden.</p>'; });

  el('ranges').addEventListener('click', function(e){
    var btn = e.target.closest('button'); if (!btn) return;
    Array.prototype.forEach.call(el('ranges').children, function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    loadHistory(btn.getAttribute('data-days'));
  });

  loadHistory(90);
</script>
</body>
</html>`;
