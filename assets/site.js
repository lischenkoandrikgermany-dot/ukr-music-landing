// UKR Hits: сторінки відкриваються без перезавантаження, а плеєр грає далі, поки людина ходить сайтом (21.11).
// Плеєр — темна смуга внизу (його вибір). На сторінці відео ролик великий; пішов на іншу сторінку — він «переїжджає» в смугу.
// Черга: після кінця збірки вмикається наступна; недоступне відео пропускається саме. Місце, де зупинився, памʼятається.
// Плюс старе: перемішування, фільтр каналів, «Показати ще», пошук пісні, поява блоків при прокрутці.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const ROOT = new URL('..', document.currentScript.src).href;   // корінь сайту: …/assets/site.js → …/
  const STEP = 24;
  const NAMES = { voron: 'VORON', mriieva: 'МРІЄВА', golden: 'GoldenWaveUA' };
  const COLORS = { voron: '#d9480f', mriieva: '#c2255c', golden: '#9c6b00' };
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hms = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shortT = t => { const s = String(t || '').split(/\s[|·—–]\s|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u)[0].trim(); return s.length >= 6 ? s : String(t || ''); };
  const local = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
  // відео, які YouTube відмовився грати в цьому сеансі, — ховаємо до кінця сеансу (сайт сам прибере їх при оновленні)
  let bad; try { bad = new Set(JSON.parse(sessionStorage.getItem('uh.bad') || '[]')); } catch { bad = new Set(); }
  const saveBad = () => { try { sessionStorage.setItem('uh.bad', JSON.stringify([...bad])); } catch {} };

  // ---------- пошуковий індекс (search.json): [id, назва, канал, [[секунда, пісня]…], наживо] ----------
  let index = null;
  const loadIndex = () => index ||= fetch(ROOT + 'search.json').then(r => r.json()).catch(() => { index = null; return []; });

  // ---------- сітка: перемішування, фільтр, «Показати ще» ----------
  const page = () => { const m = $('main'); return m ? (m._st ||= { filter: 'all', shown: STEP }) : { filter: 'all', shown: STEP }; };
  const fits = (c, st) => !bad.has(c.dataset.id) && (st.filter === 'all' || c.dataset.tag === st.filter);
  function applyGrid() {
    const g = $('#grid'); if (!g) return;
    const st = page(); let n = 0;
    for (const c of $$('.card', g)) c.hidden = !fits(c, st) || ++n > st.shown;
    const more = $('#more'); if (more) more.hidden = n <= st.shown;
  }
  // «хитре» перемішування: збірки з малою кількістю переглядів частіше потрапляють нагору — їм іде трафік із сайту
  function shuffle() {
    const g = $('#grid'); if (!g) return;
    $$('.card', g).map(c => ({ c, k: Math.pow(Math.random(), Math.sqrt((+c.dataset.v || 0) + 200) / 40) }))
      .sort((a, b) => b.k - a.k).forEach(x => g.appendChild(x.c));
    page().shown = STEP; applyGrid();
  }
  const hideBad = () => $$('.card').forEach(c => { if (bad.has(c.dataset.id)) c.hidden = true; });

  // ---------- пошук пісні або збірки ----------
  const norm = s => s.toLowerCase().replace(/[ʼ’'`]/g, '').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  async function search() {
    const q = $('#q'), out = $('#results'); if (!q || !out) return;
    const term = norm(q.value);
    if (term.length < 2) { out.innerHTML = ''; return; }
    const data = await loadIndex(), hits = [];
    for (const [id, title, tag, songs] of data) {
      if (bad.has(id)) continue;
      for (const [t, name] of songs) if (norm(name).includes(term)) hits.push({ id, title, tag, song: name, t, score: norm(name).startsWith(term) ? 0 : 1 });
      if (norm(title).includes(term)) hits.push({ id, title, tag, score: 2 });
      if (hits.length > 200) break;
    }
    hits.sort((a, b) => a.score - b.score);
    out.innerHTML = hits.length ? hits.slice(0, 20).map(h => `<a href="${ROOT}v/${h.id}/${h.t != null ? '#t=' + h.t : ''}"><img src="https://i.ytimg.com/vi/${h.id}/mqdefault.jpg" alt="" loading="lazy"><span><b>${esc(h.song || h.title)}</b><span>${h.song ? esc(h.title) + ' · з ' + hms(h.t) : NAMES[h.tag]}</span></span></a>`).join('')
      : '<p class="none">Нічого не знайшли. Спробуйте інше слово з назви пісні.</p>';
  }
  let sTimer = 0;
  document.addEventListener('input', e => { if (e.target.id === 'q') { clearTimeout(sTimer); sTimer = setTimeout(search, 160); } });
  document.addEventListener('focusin', e => { if (e.target.id === 'q') loadIndex(); });

  // ---------- поява блоків при прокрутці ----------
  function reveal() {
    if (!('IntersectionObserver' in window) || calm) return;
    const els = $$('main section h2, .about .cols > div, .songs li, .live .card, .more-vids .card').filter(e => e.getBoundingClientRect().top > innerHeight);
    els.forEach((e, i) => { e.classList.add('rise'); e.style.transitionDelay = (i % 6) * 70 + 'ms'; });
    setTimeout(() => els.forEach(e => e.classList.add('in')), 2500);
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
  }

  // =====================================================================================
  // ПЛЕЄР
  // =====================================================================================
  const svg = (p, fill = true) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'}>${p}</svg>`;
  const I = {
    play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
    pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>'),
    next: svg('<path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75l8.3-5.8a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2z"/><rect x="16.4" y="5.5" width="2.6" height="13" rx="1"/>'),
    prev: svg('<path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75l-8.3-5.8a.9.9 0 0 1 0-1.5l8.3-5.8A.9.9 0 0 1 19 6.2z"/><rect x="5" y="5.5" width="2.6" height="13" rx="1"/>'),
    x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', false),
  };
  // P.cur — що зараз у плеєрі; P.vid — яке відео реально завантажене в YouTube-плеєр
  const P = { yt: null, api: null, ok: false, cur: null, vid: null, q: [], qi: 0, state: -1, songs: [], resumeAt: 0, errs: 0, skips: 0, saveT: 0, tapT: 0, hint: false };
  let dock, pv, toastEl;

  const fromCard = c => ({ id: c.dataset.id, s: c.dataset.s || shortT($('.t', c)?.textContent), tag: c.dataset.tag, c: c.dataset.c || COLORS[c.dataset.tag], live: c.dataset.live === '1' });
  const fromRow = r => ({ id: r[0], s: shortT(r[1]), tag: r[2], c: COLORS[r[2]], live: !!r[4] });
  const lite = it => it && { id: it.id, s: it.s, tag: it.tag, c: it.c, live: !!it.live };
  const loaded = () => P.yt && P.ok && P.cur && P.vid === P.cur.id;
  const playing = () => loaded() && (P.state === 1 || P.state === 3);
  const tNow = () => { try { return loaded() ? P.yt.getCurrentTime() || 0 : P.resumeAt || 0; } catch { return 0; } };
  const tDur = () => { try { return loaded() ? P.yt.getDuration() || 0 : 0; } catch { return 0; } };

  function ensureDom() {
    if (dock) return;
    dock = document.createElement('div');
    dock.className = 'dock'; dock.hidden = true;
    dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Плеєр');
    dock.innerHTML = `<input class="dk-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Перемотати">
<div class="dk-row">
<div class="dk-slot"><img alt="" width="320" height="180"></div>
<a class="dk-info" href="${ROOT}"><span class="dk-t"><span></span></span><span class="dk-m"><span></span></span></a>
<button type="button" class="dk-b dk-prev" aria-label="Попереднє">${I.prev}</button>
<button type="button" class="dk-b dk-pp" aria-label="Слухати">${I.play}</button>
<button type="button" class="dk-b dk-next" aria-label="Далі">${I.next}</button>
<span class="dk-time" aria-hidden="true"></span>
<button type="button" class="dk-b dk-x" aria-label="Закрити плеєр">${I.x}</button>
</div>`;
    document.body.appendChild(dock);
    pv = document.createElement('div');
    pv.className = 'pv'; pv.hidden = true; pv.innerHTML = '<div id="pv-frame"></div>';
    document.body.appendChild(pv);
    toastEl = document.createElement('div');
    toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
    $('.dk-pp', dock).addEventListener('click', toggle);
    $('.dk-next', dock).addEventListener('click', () => next(false));
    $('.dk-prev', dock).addEventListener('click', prev);
    $('.dk-x', dock).addEventListener('click', close);
    $('.dk-seek', dock).addEventListener('input', e => {
      const d = tDur(); if (!loaded() || !d) return;
      P.yt.seekTo(+e.target.value / 1000 * d, true); render();
    });
    new ResizeObserver(() => requestAnimationFrame(() => place(false))).observe(document.body);
    addEventListener('resize', () => place(false));
  }

  function toast(msg) {
    ensureDom();
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastEl._h); toastEl._h = setTimeout(() => toastEl.classList.remove('on'), 3600);
  }

  function show() {
    ensureDom();
    if (!dock.hidden) return;
    dock.hidden = false; document.body.classList.add('has-dock');
    requestAnimationFrame(() => dock.classList.add('on'));
  }
  function close() {
    try { P.yt?.stopVideo(); } catch {}
    P.cur = null; P.vid = null; P.q = []; P.state = -1;
    dock.classList.remove('on'); dock.hidden = true; pv.hidden = true;
    document.body.classList.remove('has-dock');
    $$('.player.is-on').forEach(p => p.classList.remove('is-on'));
    local.del('uh.player'); markCards();
  }

  // YouTube IFrame API — вантажиться лише коли людина вперше вмикає музику
  function api() {
    return P.api ||= new Promise((res, rej) => {
      if (window.YT?.Player) return res(window.YT);
      const was = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { was?.(); res(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
      s.onerror = () => { P.api = null; rej(new Error('api')); };
      document.head.appendChild(s);
    });
  }

  async function play(item, queue, qi, start = 0) {
    if (!item) return;
    ensureDom();
    P.cur = item; P.q = queue?.length ? queue : [item]; P.qi = Math.max(0, qi || 0);
    P.resumeAt = 0; P.songs = []; P.hint = false; P.state = -1;
    loadIndex().then(d => { const r = d.find(x => x[0] === item.id); if (r && P.cur === item) { P.songs = r[3] || []; render(); } });
    show(); render(); markCards();
    try { await api(); } catch { toast('Не вдалося увімкнути плеєр YouTube. Перевірте інтернет.'); return; }
    if (P.cur !== item) return;   // поки вантажилось, людина вже вибрала інше
    P.vid = item.id;
    if (!P.yt) {
      const vars = { autoplay: 1, playsinline: 1, rel: 0, origin: location.origin };
      if (start > 0) vars.start = Math.floor(start);
      P.yt = new YT.Player('pv-frame', {
        host: 'https://www.youtube-nocookie.com', videoId: item.id, width: '100%', height: '100%', playerVars: vars,
        events: {
          onReady: () => { P.ok = true; if (P.cur && P.cur.id !== item.id) P.yt.loadVideoById(P.cur.id); else P.yt.playVideo(); place(true); render(); },
          onStateChange: onState, onError: onErr,
        },
      });
    } else if (P.ok) P.yt.loadVideoById({ videoId: item.id, startSeconds: Math.floor(start) || 0 });
    place(true); waitTap();
  }

  // якщо браузер не дав увімкнути звук сам (буває на iPhone) — підказати торкнутися відео
  function waitTap() {
    clearTimeout(P.tapT);
    P.tapT = setTimeout(() => { if (P.cur && !playing() && P.state !== 2) { P.hint = true; pv?.classList.add('tap'); render(); } }, 3500);
  }

  function onState(e) {
    P.state = e.data;   // -1 не почалось, 0 кінець, 1 грає, 2 пауза, 3 вантажиться, 5 готове
    if (P.state === 1) { P.hint = false; P.errs = 0; P.skips = 0; pv.classList.remove('tap'); }
    if (P.state === 0) {
      if (P.cur?.live) { bad.add(P.cur.id); saveBad(); hideBad(); }   // ефір закінчився
      next(true);
    }
    render(); markCards();
  }
  function onErr() {
    const it = P.cur; if (!it) return;
    bad.add(it.id); saveBad(); hideBad(); applyGrid();
    if (++P.errs > 4) { toast('Не вдається увімкнути відео. Перевірте інтернет.'); return; }
    toast('Цей запис зараз недоступний — вмикаю наступний');
    next(true);
  }

  async function extend() {   // черга скінчилась — додати ще збірки того ж каналу з індексу (новіші → старіші)
    const data = await loadIndex(); if (!data.length) return false;
    const have = new Set(P.q.map(x => x.id)), tag = P.cur?.tag;
    const pos = data.findIndex(r => r[0] === P.cur?.id);
    const ok = (r, sameTag) => !have.has(r[0]) && !bad.has(r[0]) && !r[4] && (!sameTag || r[2] === tag);
    let pool = [...data.slice(pos + 1), ...data.slice(0, Math.max(0, pos))].filter(r => ok(r, true));
    if (!pool.length) pool = data.filter(r => ok(r, false));
    if (!pool.length) return false;
    P.q.push(...pool.slice(0, 12).map(fromRow));
    return true;
  }
  function goTo(i) {
    const it = P.q[i]; if (!it) return;
    if (bad.has(it.id)) { P.qi = i; if (++P.skips > P.q.length + 3) return; return next(true); }
    play(it, P.q, i, 0);
  }
  async function next(auto) {
    if (P.qi < P.q.length - 1) return goTo(P.qi + 1);
    if (await extend()) return goTo(P.qi + 1);
    if (P.q.length > 1) return goTo(0);
    if (!auto) toast('Це остання збірка в черзі');
  }
  function prev() {
    if (loaded() && !P.cur.live && tNow() > 5) { P.yt.seekTo(0, true); return; }
    if (P.qi > 0) goTo(P.qi - 1); else if (loaded()) P.yt.seekTo(0, true);
  }
  function toggle() {
    if (!P.cur) return;
    if (!loaded()) return play(P.cur, P.q, P.qi, P.resumeAt);
    if (playing()) P.yt.pauseVideo(); else P.yt.playVideo();
  }

  // де стоїть відео: на сторінці цього ролика — великим на місці превʼю; деінде — маленьким у смузі
  function place(anim) {
    if (!pv) return;
    if (!P.cur || P.vid !== P.cur.id) { pv.hidden = true; dock?.classList.remove('in-page'); $$('.player.is-on').forEach(p => p.classList.remove('is-on')); return; }
    const host = $$('.player').find(p => p.dataset.id === P.cur.id);
    const from = anim && !calm && !pv.hidden ? pv.getBoundingClientRect() : null;
    pv.hidden = false;
    $$('.player.is-on').forEach(p => p !== host && p.classList.remove('is-on'));
    if (host) {
      host.classList.add('is-on'); dock.classList.add('in-page');
      const r = host.getBoundingClientRect();
      Object.assign(pv.style, { position: 'absolute', left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px' });
      pv.dataset.mode = 'page';
    } else {
      dock.classList.remove('in-page');
      const r = $('.dk-slot', dock).getBoundingClientRect();
      Object.assign(pv.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      pv.dataset.mode = 'mini';
    }
    if (from) {
      const to = pv.getBoundingClientRect();
      if (to.width && Math.abs(from.left - to.left) + Math.abs(from.top - to.top) + Math.abs(from.width - to.width) > 6)
        pv.animate([{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${from.height / to.height})` }, { transform: 'none' }],
          { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  function setRun(box, text) {
    const sp = box.firstElementChild;
    if (sp.textContent === text) return;
    sp.textContent = text; box.classList.remove('run');
    requestAnimationFrame(() => {   // довга назва — повільно пливе, щоб прочитати цілком (не обрізаємо)
      const over = sp.scrollWidth - box.clientWidth;
      if (over > 4 && !calm) { box.style.setProperty('--d', over + 32 + 'px'); box.style.setProperty('--dur', Math.max(8, (over + 32) / 28) + 's'); box.classList.add('run'); }
    });
  }
  function songAt(t) { let s = null; for (const x of P.songs) { if (x[0] <= t + 1) s = x; else break; } return s; }

  function render() {
    if (!dock || !P.cur) return;
    const it = P.cur, t = tNow(), d = tDur(), on = loaded();
    const song = !it.live && P.songs.length ? songAt(t) : null;
    setRun($('.dk-t', dock), song ? song[1] : it.s);
    const parts = [NAMES[it.tag] || ''];
    if (song) parts.push(it.s);
    if (it.live) parts.push('Наживо');
    const m = $('.dk-m', dock);
    m.classList.toggle('hint', P.hint);
    setRun(m, P.hint ? 'Торкніться відео, щоб увімкнути звук' : !on && P.resumeAt > 10 ? `Продовжити з ${hms(P.resumeAt)} · ${NAMES[it.tag] || ''}` : parts.filter(Boolean).join(' · '));
    const pp = $('.dk-pp', dock), isP = playing();
    if (pp._p !== isP) { pp.innerHTML = isP ? I.pause : I.play; pp.setAttribute('aria-label', isP ? 'Пауза' : 'Слухати'); pp._p = isP; }
    $('.dk-time', dock).textContent = it.live ? 'Наживо' : d ? `${hms(t)} / ${hms(d)}` : on ? '' : (P.resumeAt ? hms(P.resumeAt) : '');
    const seek = $('.dk-seek', dock);
    if (!seek.matches(':active')) seek.value = d ? Math.round(t / d * 1000) : 0;
    seek.style.setProperty('--p', (d ? t / d * 100 : 0) + '%');
    seek.disabled = !!it.live || !d;
    dock.classList.toggle('is-live', !!it.live);
    dock.style.setProperty('--c', it.c || '#d9480f');
    const img = $('.dk-slot img', dock), src = `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`;
    if (img.getAttribute('src') !== src) img.src = src;
    $('.dk-info', dock).href = `${ROOT}v/${it.id}/`;
    // підсвітити пісню, що звучить, у списку на сторінці відео
    const host = $('.player');
    if (host && host.dataset.id === it.id) $$('.songs .at').forEach(b => b.classList.toggle('now', !!song && +b.dataset.t === song[0]));
  }
  function markCards() {
    const id = P.cur?.id, isP = playing();
    for (const c of $$('.card')) {
      const me = c.dataset.id === id, b = $('.qp', c);
      c.classList.toggle('is-playing', me);
      if (b && b._p !== (me && isP)) { b._p = me && isP; b.innerHTML = b._p ? I.pause : I.play; b.setAttribute('aria-label', (b._p ? 'Пауза: ' : 'Слухати: ') + (c.dataset.s || '')); }
    }
  }

  function save() {
    if (!P.cur) return;
    P.saveT = Date.now();
    const a = Math.max(0, P.qi - 5);
    local.set('uh.player', { it: lite(P.cur), t: P.cur.live ? 0 : Math.floor(tNow()), q: P.q.slice(a, P.qi + 30).map(lite), qi: P.qi - a, at: Date.now() });
  }
  setInterval(() => {
    if (!P.cur || !loaded()) return;
    render();
    if (P.state === 1 && Date.now() - P.saveT > 5000) save();
  }, 500);
  addEventListener('pagehide', save);

  // з картки / зі сторінки відео / «Слухати все»
  function playCard(card) {
    const id = card.dataset.id;
    if (P.cur?.id === id && loaded()) return toggle();
    const g = card.closest('.grid'), st = page();
    const list = $$('.card', g).filter(c => g.id === 'grid' ? fits(c, st) : !bad.has(c.dataset.id));
    const q = list.map(fromCard), i = Math.max(0, q.findIndex(x => x.id === id));
    play(q[i] || fromCard(card), q.length ? q : [fromCard(card)], i, 0);
  }
  function playAll() {
    const g = $('#grid'); if (!g) return;
    const st = page(), list = $$('.card', g).filter(c => fits(c, st));
    if (list.length) play(fromCard(list[0]), list.map(fromCard), 0, 0);
  }
  function pageItem() { const p = $('.player'); return p && { id: p.dataset.id, s: p.dataset.s, tag: p.dataset.tag, c: p.dataset.c, live: p.dataset.live === '1' }; }
  function playPage(t = 0) {
    const it = pageItem(); if (!it) return;
    if (P.cur?.id === it.id && loaded()) { P.yt.seekTo(t, true); P.yt.playVideo(); place(true); return; }
    const rest = $$('.more-vids .card').map(fromCard).filter(x => x.id !== it.id && !bad.has(x.id));
    play(it, [it, ...rest], 0, t);
  }

  // =====================================================================================
  // ПЕРЕХОДИ БЕЗ ПЕРЕЗАВАНТАЖЕННЯ (плеєр не зупиняється)
  // =====================================================================================
  const clean = u => { const x = new URL(u, location.href); x.hash = ''; return x.href; };
  const pages = new Map();   // адреса → обіцянка HTML (кеш)
  const snaps = new Map();   // адреса → сторінка, з якої пішли (для «Назад» — у тому ж вигляді й на тому ж місці)
  let curUrl = clean(location.href), navN = 0;
  function internal(a) {
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return false;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || !u.href.startsWith(ROOT)) return false;
    if (/\.(xml|json|txt|webmanifest|svg|png|jpe?g|html?)$/i.test(u.pathname) && !/index\.html?$/i.test(u.pathname)) return false;
    return true;
  }
  function fetchPage(u) {
    const k = clean(u);
    if (!pages.has(k)) {
      const p = fetch(k, { credentials: 'same-origin' }).then(r => { if (!r.ok || !(r.headers.get('content-type') || '').includes('html')) throw new Error(r.status); return r.text(); });
      pages.set(k, p); p.catch(() => pages.delete(k));
    }
    return pages.get(k);
  }
  const metaOf = d => ({ desc: d.querySelector('meta[name="description"]')?.content || '', canon: d.querySelector('link[rel="canonical"]')?.href || '', robots: d.querySelector('meta[name="robots"]')?.content || '' });
  function setMeta(m) {
    const set = (sel, make, attr, val) => { let el = $(sel, document.head); if (!val) { el?.remove(); return; } if (!el) { el = make(); document.head.appendChild(el); } el.setAttribute(attr, val); };
    set('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', m.desc);
    set('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', m.canon);
    set('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' }), 'content', m.robots);
  }
  function current() { return { bar: $('.bar'), main: $('main'), foot: $('.foot'), title: document.title, cls: document.body.className.replace(/\bhas-dock\b/, '').trim(), style: document.body.getAttribute('style') || '', meta: metaOf(document), y: scrollY }; }

  async function navigate(url, { push = true, back = false } = {}) {
    const n = ++navN, key = clean(url);
    let nx = back && snaps.get(key);
    if (!nx) {
      let html;
      try { html = await fetchPage(url); } catch { location.href = url; return; }
      if (n !== navN) return;   // поки вантажилось, людина вже натиснула інше
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc.querySelector('main')) { location.href = url; return; }
      nx = { bar: doc.querySelector('.bar'), main: doc.querySelector('main'), foot: doc.querySelector('.foot'), title: doc.title, cls: doc.body.className, style: doc.body.getAttribute('style') || '', meta: metaOf(doc), fresh: true };
    }
    snaps.set(curUrl, current());
    if (snaps.size > 15) snaps.delete(snaps.keys().next().value);
    if (push) { history.replaceState({ y: scrollY }, ''); history.pushState({ y: 0 }, '', url); }
    curUrl = key;
    document.title = nx.title;
    document.body.className = nx.cls + (dock && !dock.hidden ? ' has-dock' : '');
    if (nx.style) document.body.setAttribute('style', nx.style); else document.body.removeAttribute('style');
    for (const sel of ['.bar', 'main', '.foot']) { const a = $(sel), b = nx[sel === '.bar' ? 'bar' : sel === 'main' ? 'main' : 'foot']; if (a && b && a !== b) a.replaceWith(b); }
    setMeta(nx.meta);
    const hash = new URL(url, location.href).hash;
    if (back) scrollTo(0, nx.y || 0);
    else if (hash.length > 1 && !hash.startsWith('#t=')) { const el = document.getElementById(decodeURIComponent(hash.slice(1))); el ? el.scrollIntoView() : scrollTo(0, 0); }
    else scrollTo(0, 0);
    if (nx.fresh) initPage();
    hideBad(); place(true); markCards(); render();
    const h1 = $('main h1'); if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  }
  history.scrollRestoration = 'manual';
  addEventListener('popstate', () => navigate(location.href, { push: false, back: true }));
  // підвантажити сторінку, щойно людина навела мишку / торкнулась — тоді перехід миттєвий
  document.addEventListener('pointerover', e => { const a = e.target.closest?.('a[href]'); if (!internal(a)) return; const u = a.href; clearTimeout(a._pf); a._pf = setTimeout(() => fetchPage(u).catch(() => {}), 70); });   // адресу беремо одразу: після переходу відносне посилання старої сторінки вело б не туди
  document.addEventListener('pointerout', e => { const a = e.target.closest?.('a[href]'); if (a) clearTimeout(a._pf); });
  document.addEventListener('touchstart', e => { const a = e.target.closest?.('a[href]'); if (internal(a)) fetchPage(a.href).catch(() => {}); }, { passive: true });

  // ---------- усі натискання — в одному місці (працює і на сторінках, що підвантажились без перезавантаження) ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) {
      if (b.id === 'more') { page().shown += STEP; applyGrid(); return; }
      if (b.id === 'shuffle') { shuffle(); return; }
      if (b.id === 'playall') { playAll(); return; }
      if (b.classList.contains('f')) {
        const st = page(); st.filter = b.dataset.f; st.shown = STEP;
        $$('.f').forEach(x => x.setAttribute('aria-pressed', String(x === b))); applyGrid(); return;
      }
      if (b.classList.contains('qp')) { playCard(b.closest('.card')); return; }
      if (b.classList.contains('play') && b.closest('.player')) { playPage(0); return; }
      if (b.classList.contains('at')) { playPage(+b.dataset.t); const pl = $('.player'); if (pl && pl.getBoundingClientRect().top < 0) pl.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' }); return; }
      return;
    }
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !internal(a)) return;
    const u = new URL(a.href, location.href);
    if (clean(u.href) === curUrl && u.hash && !u.hash.startsWith('#t=')) return;   // якір на тій самій сторінці — браузер прокрутить сам
    e.preventDefault();
    if (clean(u.href) === curUrl && !u.hash) { scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' }); return; }
    navigate(u.href);
  });

  // ---------- запуск сторінки ----------
  function initPage() {
    if ($('#grid')) { if (document.body.classList.contains('home')) shuffle(); else applyGrid(); }
    hideBad(); reveal();
    const m = /t=(\d+)/.exec(location.hash);
    if (m && $('.player')) playPage(+m[1]);
  }
  initPage();

  // повернувся на сайт — плеєр показує, що слухав востаннє, і продовжить з того ж місця (тиждень)
  const saved = local.get('uh.player');
  if (!P.cur && saved?.it && Date.now() - (saved.at || 0) < 7 * 864e5) {
    ensureDom();
    P.cur = saved.it; P.q = saved.q?.length ? saved.q : [saved.it]; P.qi = Math.min(saved.qi || 0, P.q.length - 1);
    P.resumeAt = saved.it.live ? 0 : saved.t || 0;
    loadIndex().then(d => { const r = d.find(x => x[0] === P.cur?.id); if (!r) { if (P.cur && !loaded()) close(); return; } P.songs = r[3] || []; render(); });
    show(); render(); markCards();
  }
})();
