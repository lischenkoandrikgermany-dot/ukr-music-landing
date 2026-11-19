// UKR Hits: перемішування, фільтр каналів, «Показати ще», пошук пісні, плеєр на сторінці відео, поява при прокрутці.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const STEP = 24;
  const grid = $('#grid');
  const more = $('#more');
  const isHome = document.body.classList.contains('home');
  const isChan = document.body.classList.contains('chan');
  let filter = 'all', shown = STEP;

  function shuffle() {
    if (!grid) return;
    const cards = $$('.card', grid);
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    cards.forEach(c => grid.appendChild(c));
    shown = STEP; apply();
  }
  function apply() {
    if (!grid) return;
    let n = 0;
    for (const c of $$('.card', grid)) {
      const ok = filter === 'all' || c.dataset.tag === filter;
      c.hidden = !ok || ++n > shown;
    }
    if (more) more.hidden = n <= shown;
  }
  if (grid) {
    if (isHome) shuffle(); else apply();   // головна — щоразу новий порядок; канал — свіжі зверху
    more?.addEventListener('click', () => { shown += STEP; apply(); });
    $('#shuffle')?.addEventListener('click', shuffle);
    $$('.f').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.f; shown = STEP;
      $$('.f').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      apply();
    }));
  }

  // пошук пісні або збірки: індекс вантажиться лише коли людина почала шукати
  const q = $('#q'), out = $('#results');
  let index = null, timer = 0;
  const norm = s => s.toLowerCase().replace(/[ʼ’'`]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const hms = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const NAMES = { voron: 'VORON', mriieva: 'МРІЄВА', golden: 'GoldenWaveUA' };
  async function load() { if (!index) index = await (await fetch('search.json')).json(); return index; }
  async function search() {
    const term = norm(q.value);
    if (term.length < 2) { out.innerHTML = ''; return; }
    const data = await load();
    const hits = [];
    for (const [id, title, tag, songs] of data) {
      for (const [t, name] of songs) if (norm(name).includes(term)) hits.push({ id, title, tag, song: name, t, score: norm(name).startsWith(term) ? 0 : 1 });
      if (norm(title).includes(term)) hits.push({ id, title, tag, score: 2 });
      if (hits.length > 200) break;
    }
    hits.sort((a, b) => a.score - b.score);
    const top = hits.slice(0, 20);
    out.innerHTML = top.length ? top.map(h => `<a href="v/${h.id}/${h.t != null ? '#t=' + h.t : ''}"><img src="https://i.ytimg.com/vi/${h.id}/mqdefault.jpg" alt="" loading="lazy"><span><b>${esc(h.song || h.title)}</b><span>${h.song ? esc(h.title) + ' · з ' + hms(h.t) : NAMES[h.tag]}</span></span></a>`).join('')
      : '<p class="none">Нічого не знайшли. Спробуйте інше слово з назви пісні.</p>';
  }
  q?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 160); });
  q?.addEventListener('focus', () => { load().catch(() => {}); }, { once: true });

  // плеєр на сторінці відео: вмикається по натисканню, пісні зі списку — з потрібної хвилини
  const player = $('.player');
  function play(t) {
    if (!player) return;
    const id = player.dataset.id;
    player.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${t ? '&start=' + t : ''}" title="Відео" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  }
  if (player) {
    $('.play', player)?.addEventListener('click', () => play(0));
    $$('.at').forEach(b => b.addEventListener('click', () => { play(+b.dataset.t); player.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
    const m = /t=(\d+)/.exec(location.hash);
    if (m) play(+m[1]);
  }

  // поява блоків при прокрутці (заголовок, текст, картки — по черзі)
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // що видно одразу — не ховаємо; решта зʼявляється при прокрутці; страховка — показати все через 2,5 с
    const els = $$('section h2, .about .cols > div, .songs li, .live .card, .more-vids .card').filter(e => e.getBoundingClientRect().top > innerHeight);
    els.forEach((e, i) => { e.classList.add('rise'); e.style.transitionDelay = (i % 6) * 70 + 'ms'; });
    setTimeout(() => els.forEach(e => e.classList.add('in')), 2500);
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
  }
})();
