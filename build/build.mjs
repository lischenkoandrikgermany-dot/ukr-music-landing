// build.mjs — сайт UKR Hits: «міні-YouTube» трьох українських каналів (VORON, МРІЄВА, GoldenWaveUA).
// Тягне свіжі відео з YouTube-лент (RSS), додає їх в архів (build/archive.json) і будує статичні сторінки:
// головна (перемішування + пошук пісні), сторінка каналу, окрема сторінка кожного відео (плеєр, список пісень,
// розмітка VideoObject), карти сайту для Google. Запуск: node build/build.mjs (Node 18+, без залежностей).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'channels.json'), 'utf8'));
const SITE = cfg.site;
const BASE = SITE.url.replace(/\/$/, '');
const CH = Object.fromEntries(cfg.channels.map(c => [c.tag, c]));
const ARCHIVE = path.join(DIR, 'archive.json');
const VER = crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, 'assets/site.css'))).update(fs.readFileSync(path.join(ROOT, 'assets/site.js'))).digest('hex').slice(0, 8);
const now = new Date();
const today = now.toISOString().slice(0, 10);

// ---------- утиліти ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decodeXml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const secs = iso => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || []; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); };
const hms = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const durWords = s => s >= 3600 ? `${Math.floor(s / 3600)} год ${Math.round(s % 3600 / 60)} хв` : `${Math.round(s / 60)} хв`;
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const dateUa = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const views = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн переглядів' : n >= 1e3 ? Math.round(n / 1e3) + ' тис. переглядів' : n ? n + ' переглядів' : '';
const write = (rel, html) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
const thumb = (id, q = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
const shortT = t => { const s = String(t || '').split(/\s[|·—–]\s|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u)[0].trim(); return s.length >= 6 ? s : String(t || ''); };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : s; };

// список пісень із таймкодами в описі: «00:00 Назва» / «1:02:03 — Назва»
function tracks(desc) {
  const out = [];
  for (const line of String(desc || '').split('\n')) {
    const m = /^\s*(?:\d+[.)]\s*)?((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—.|:]?\s*(.{2,90})$/.exec(line);
    if (!m) continue;
    const [p1, p2, p3] = m[1].split(':').map(Number);
    const t = p3 === undefined ? p1 * 60 + p2 : p1 * 3600 + p2 * 60 + p3;
    const name = m[2].replace(/\s+/g, ' ').trim();
    if (/^(підпис|subscribe|дякую|слухай|#)/i.test(name)) continue;
    out.push([t, name]);
  }
  return out.length >= 3 ? out : [];
}
// перший абзац опису без хештегів, посилань і таймкодів
function lead(desc) {
  const parts = String(desc || '').split(/\n\s*\n/).map(p => p.replace(/https?:\/\/\S+/g, '').replace(/#\S+/g, '').trim())
    .filter(p => p && !/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}/m.test(p) && !/^[🎵🎶]?\s*(список|tracklist|таймкод)/i.test(p));
  return parts.slice(0, 2).join('\n\n');
}

// ---------- 1. архів + свіжі відео з RSS ----------
let archive = [];
try { archive = JSON.parse(fs.readFileSync(ARCHIVE, 'utf8')); } catch {}
const byId = new Map(archive.map(v => [v.id, v]));
async function feed(ch) {
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UkrHitsBot/2.0)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    return xml.split('<entry>').slice(1).map(e => ({
      id: (e.match(/<yt:videoId>([^<]+)</) || [])[1],
      title: decodeXml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
      description: decodeXml((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || ''),
      published: (e.match(/<published>([^<]+)</) || [])[1] || '',
      views: +((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0),
      short: /youtube\.com\/shorts\//.test(e),
      tag: ch.tag,
    })).filter(v => v.id && v.title);
  } catch (e) { console.error(`! ${ch.name}: ${e.message}`); return []; }
}
let added = 0;
const inFeed = new Set();
for (const list of await Promise.all(cfg.channels.map(feed))) for (const v of list) {
  inFeed.add(v.id);
  const old = byId.get(v.id);
  if (old) { old.title = v.title; if (v.description) old.description = v.description.slice(0, 4000); if (v.views) old.views = v.views; if (v.short) old.short = true; }
  else { byId.set(v.id, { ...v, description: v.description.slice(0, 4000), duration: null, live: false }); added++; }
}
archive = [...byId.values()].sort((a, b) => (b.published || '').localeCompare(a.published || ''));

// ---------- 1б. перевірка: чи відео живе, чи його можна грати на сайті, чи ефір ще йде (21.11) ----------
// Без ключів і паролів. oEmbed: 200 — можна вбудувати, 401/403 — заборонено вбудовувати або приватне, 404 — видалене.
// Сторінка YouTube: статус програвання, «наживо зараз», тривалість. Якщо YouTube нічого певного не відповів
// (збій мережі, «підтвердіть, що ви не бот») — рішення не змінюємо: краще лишити старе, ніж сховати живе.
// Закінчені ефіри без запису, видалені й невбудовувані відео зникають із сайту самі; повернуться, якщо їх полагодять.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HOUR = 3600e3, nowMs = now.getTime();
async function get(url, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'uk,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' } });
    return { code: r.status, text: r.ok ? await r.text() : '' };
  } catch { return { code: 0, text: '' }; } finally { clearTimeout(t); }
}
async function pool(items, n, fn) {
  let i = 0; const out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
const oembed = async id => (await get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, 15000)).code;
async function watch(id) {
  const { code, text } = await get(`https://www.youtube.com/watch?v=${id}`, 25000);
  const m = code === 200 && /ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s.exec(text);
  if (!m) return null;
  let p; try { p = JSON.parse(m[1]); } catch { return null; }
  const ps = p.playabilityStatus || {};
  if (!p.videoDetails || ps.status === 'LOGIN_REQUIRED') return null;   // перевірка «чи ви не бот» — нічого не знаємо
  const lb = p.microformat?.playerMicroformatRenderer?.liveBroadcastDetails || {};
  return { status: ps.status, embed: ps.playableInEmbed !== false, liveNow: lb.isLiveNow === true, stream: !!lb.startTimestamp, len: +(p.videoDetails.lengthSeconds || 0) };
}
const iso = s => `PT${Math.floor(s / 3600)}H${Math.floor(s % 3600 / 60)}M${s % 60}S`;
const age = v => v.checked ? nowMs - Date.parse(v.checked) : Infinity;
const streamish = v => v.live || v.duration === 'P0D' || !v.duration;   // ефір або ще невідомо, що це
{
  const cand = archive.filter(v => CH[v.tag] && !v.short);
  const must = new Set(cand.filter(v => !v.checked || streamish(v) || (v.ok === false && age(v) > 6 * HOUR)));
  const rest = cand.filter(v => !must.has(v) && age(v) > 20 * HOUR).sort((a, b) => age(b) - age(a)).slice(0, 300);
  const list = [...must, ...rest];
  const res = await pool(list, 6, async v => {
    const oe = await oembed(v.id);
    const w = streamish(v) || (oe && oe !== 200) ? await watch(v.id) : null;
    return { v, oe, w };
  });
  let flips = 0;
  const plan = res.map(({ v, oe, w }) => {
    const known = !!w || [200, 401, 403, 404].includes(oe);
    if (!known) return null;
    const p = { v };
    if (w) {
      p.stream = w.stream;
      p.ok = w.status === 'OK' && w.embed;
      p.live = w.status === 'OK' && w.liveNow;
      if (p.live) p.duration = 'P0D';
      else if (w.status === 'OK' && w.len > 0) p.duration = iso(w.len);
    } else {
      p.ok = oe === 200;
      // сторінку YouTube не прочитали: ефір без запису після кінця зникає зі стрічки каналу — тоді вважаємо його завершеним
      p.live = v.live && inFeed.has(v.id);
      if (v.live && !p.live) p.ok = false;
    }
    if (v.ok !== false && !p.ok) flips++;
    return p;
  }).filter(Boolean);
  const panic = flips > Math.max(20, list.length * 0.25);   // раптом «зламалося» забагато — це збій перевірки, а не відео
  if (panic) console.error(`! перевірка: ${flips} відео раптом недоступні — схоже на збій YouTube, нічого не ховаю`);
  for (const p of plan) {
    const v = p.v;
    if (panic && !p.ok && v.ok !== false) continue;
    if (p.stream || p.live || v.duration === 'P0D') v.stream = true;
    v.ok = p.ok; v.live = p.live; if (p.duration) v.duration = p.duration;
    if (v.ok) delete v.gone; else v.gone ||= now.toISOString();
    v.checked = now.toISOString();
  }
  const watched = res.filter(x => streamish(x.v) || (x.oe && x.oe !== 200)).length;
  console.log(`перевірка: ${list.length} відео (сторінок YouTube: ${watched}, без відповіді: ${res.length - plan.length}), недоступних зараз: ${archive.filter(v => v.ok === false).length}`);
}
// давно недоступні (90+ днів) — з архіву геть
archive = archive.filter(v => !(v.ok === false && v.gone && nowMs - Date.parse(v.gone) > 90 * 24 * HOUR));
fs.writeFileSync(ARCHIVE, JSON.stringify(archive, null, 1));
console.log(`архів: ${archive.length} відео, нових: ${added}`);

// на сайт — без коротких (shorts) і без недоступних; прямі ефіри — окремо зверху, лише ті, що йдуть зараз
const isShort = v => v.short || (!v.live && secs(v.duration) > 0 && secs(v.duration) <= 180);   // P0D — це ефір, не шортс
const videos = archive.filter(v => CH[v.tag] && !isShort(v) && v.ok !== false);
const gone = archive.filter(v => CH[v.tag] && !isShort(v) && v.ok === false && nowMs - Date.parse(v.gone || 0) < 45 * 24 * HOUR);
const live = videos.filter(v => v.live);
const regular = videos.filter(v => !v.live);
for (const v of videos) { v.tr = tracks(v.description); v.sec = secs(v.duration); }
if (!videos.length) { console.error('Жодного відео — сайт не перебудовую.'); process.exit(0); }

// ---------- 2. спільні шматки ----------
const icoYT = '<svg viewBox="0 0 28 20" aria-hidden="true" width="28" height="20"><rect width="28" height="20" rx="5" fill="#FF0000"/><path d="M11 5.5l7.5 4.5-7.5 4.5z" fill="#fff"/></svg>';
const icoTG = '<svg viewBox="0 0 24 24" aria-hidden="true" width="22" height="22"><circle cx="12" cy="12" r="12" fill="#229ED9"/><path d="M5.4 11.8l10.9-4.2c.5-.2 1 .1.8.9l-1.9 8.8c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.3-4.8c.2-.2 0-.3-.3-.1l-6.6 4.1-2.8-.9c-.6-.2-.6-.6.2-.8z" fill="#fff"/></svg>';
const icoPlay = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const playAll = (label = 'Слухати все') => `<button type="button" class="btn main" id="playall">${icoPlay}<span>${label}</span></button>`;
function head({ title, desc, canon, rel, img, ld = [], type = 'website', robots = '' }) {
  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">${robots ? `<meta name="robots" content="${robots}">` : ''}
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${esc(SITE.name)}"><meta property="og:locale" content="uk_UA">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canon}">
<meta property="og:image" content="${img}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f3f2ee">
<link rel="icon" href="${rel}favicon.svg" type="image/svg+xml"><link rel="manifest" href="${rel}manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://i.ytimg.com">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rel}assets/site.css?v=${VER}">
${ld.map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>`;
}
function bar(rel, active) {
  const links = cfg.channels.map(c => `<a href="${rel}${c.slug}/"${active === c.tag ? ' aria-current="page"' : ''} style="--c:${c.color}">${esc(c.name)}</a>`).join('')
    + (live.length ? `<a href="${rel}#efir">Прямі ефіри</a>` : '') + `<a href="${rel}best/"${active === 'best' ? ' aria-current="page"' : ''}>Найкращі</a>`;
  const tg = SITE.telegram ? `<a class="btn tg small" href="${SITE.telegram}" target="_blank" rel="noopener">${icoTG}<span>Telegram</span></a>` : '';
  return `<header class="bar"><a class="mark" href="${rel}">${esc(SITE.name)}</a><nav aria-label="Розділи">${links}</nav>${tg}</header>`;
}
function follow(rel) {
  const yt = cfg.channels.map(c => `<a class="btn yt" href="${c.youtube}?sub_confirmation=1" target="_blank" rel="noopener">${icoYT}<span>${esc(c.name)} на YouTube</span></a>`).join('');
  const tg = SITE.telegram ? `<a class="btn tg" href="${SITE.telegram}" target="_blank" rel="noopener">${icoTG}<span>Наш Telegram</span></a>` : '';
  return `<div class="follow">${yt}${tg}</div>`;
}
function foot(rel) {
  return `<footer class="foot">
<h2 class="fh">Наші YouTube-канали</h2>
<p>Усі пісні на цьому сайті — з наших трьох YouTube-каналів. Підпишіться на той, що до душі, щоб нові збірки й прямі ефіри приходили вам на YouTube першими.</p>
<div class="chans">${cfg.channels.map(c => `<a class="chan-btn" href="${c.youtube}?sub_confirmation=1" target="_blank" rel="noopener">${icoYT}<span><b>${esc(c.name)}</b><small>YouTube-канал · ${esc(c.about.split(':')[0])}</small></span></a>`).join('')}</div>
${SITE.telegram ? `<h2 class="fh">Наш Telegram-канал</h2><p>Нові пісні, прямі ефіри й добірки — щодня в Telegram.</p><a class="chan-btn tgb" href="${SITE.telegram}" target="_blank" rel="noopener">${icoTG}<span><b>Підписатися в Telegram</b><small>Відкриється у застосунку Telegram</small></span></a>` : ''}
<p class="big">${esc(SITE.name)}</p>
<p class="small">Оновлено ${dateUa(now.toISOString())}. Відео програються з YouTube.</p>
</footer>
<script src="${rel}assets/site.js?v=${VER}" defer></script>
</body></html>`;
}
function card(v, rel) {
  const c = CH[v.tag];
  const meta = [v.live ? 'Наживо' : v.sec ? durWords(v.sec) : '', v.live ? '' : dateUa(v.published)].filter(Boolean).join(' · ');
  const st = shortT(v.title);
  return `<div class="card" data-id="${v.id}" data-tag="${v.tag}" data-live="${v.live ? 1 : 0}" data-v="${v.views || 0}" data-s="${esc(st)}" data-c="${c.color}" style="--c:${c.color}">
<a class="cl" href="${rel}v/${v.id}/"><span class="th"><img src="${thumb(v.id)}" alt="" loading="lazy" width="480" height="270">${v.live ? '<span class="onair">Наживо</span>' : v.sec ? `<span class="len">${hms(v.sec)}</span>` : ''}</span>
<span class="t">${esc(v.title)}</span>
<span class="m"><b>${esc(c.name)}</b>${meta ? ' · ' + esc(meta) : ''}</span></a>
<span class="qpz"><button type="button" class="qp" aria-label="Слухати: ${esc(st)}">${icoPlay}</button></span></div>`;
}

// ---------- 3. головна ----------
const shownHome = regular.slice(0, 240);
const homeLD = [
  { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.full, url: BASE + '/', inLanguage: 'uk' },
  { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Українські пісні — нові збірки', itemListElement: shownHome.slice(0, 30).map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/v/${v.id}/` })) },
  { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
    ['Де слухати українські пісні 2026 онлайн?', 'На UKR Hits зібрані свіжі збірки українських пісень з каналів VORON, МРІЄВА і GoldenWaveUA. Слухати можна безкоштовно і без реєстрації, нові відео з’являються автоматично.'],
    ['Яку українську музику послухати в машині?', 'Для дороги — канал VORON: драйвові українські хіти, нічна траса й шансон у збірках на дві години, а також прямі ефіри цілодобово.'],
    ['Де знайти українські пісні про кохання?', 'Пісні про кохання — на GoldenWaveUA, а ліричні пісні для душі з жіночим вокалом — на МРІЄВА.'],
    ['Як знайти пісню з відео?', 'Почніть вводити назву пісні у пошуку вгорі сторінки: сайт покаже збірку і хвилину, з якої звучить пісня.'],
  ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
];
const filters = `<div class="filters" role="group" aria-label="Фільтр за каналом"><button type="button" class="f" data-f="all" aria-pressed="true">Усі</button>${cfg.channels.map(c => `<button type="button" class="f" data-f="${c.tag}" aria-pressed="false" style="--c:${c.color}">${esc(c.name)}</button>`).join('')}</div>`;
// головна картинка: задана в channels.json (site.hero — id відео; його слово 19.11: не контрастне превʼю, з VORON)
const hero = videos.find(v => v.id === SITE.hero) || regular.find(v => v.tag === 'voron') || regular[0] || live[0];
write('index.html', `${head({ title: 'Українські пісні 2026 — музика в машину, для душі та про кохання | UKR Hits', desc: 'Свіжі українські пісні 2026: музика в машину, пісні для душі та про кохання. Збірки й прямі ефіри VORON, МРІЄВА і GoldenWaveUA — слухайте безкоштовно, знайдіть свою пісню.', canon: BASE + '/', rel: '', img: thumb(hero.id, 'hqdefault'), ld: homeLD })}
<body class="home">
${bar('', '')}
<main>
<section class="hero">
<div class="hero-text">
<h1>Українська музика для дороги й душі</h1>
<p class="lede">Свіжі збірки VORON, МРІЄВА і GoldenWaveUA в одному місці: хіти в машину, пісні для душі та про кохання. Нові відео з’являються тут самі.</p>
<form class="find" role="search" onsubmit="return false">
<label for="q">Знайти пісню або збірку</label>
<div class="row"><input id="q" type="search" placeholder="Наприклад: Мій теплий причал" autocomplete="off" enterkeyhint="search"></div>
</form>
<div id="results" class="results" aria-live="polite"></div>
<div class="acts">${playAll('Слухати без зупинки')}<button type="button" class="btn ghost" id="shuffle">Перемішати</button></div>
</div>
<a class="hero-pic" href="v/${hero.id}/"><img src="${thumb(hero.id, 'maxresdefault')}" onerror="this.onerror=null;this.src='${thumb(hero.id)}'" alt="${esc(hero.title)}" width="1280" height="720"><span class="cap">${hero.live ? '<b class="onair">Наживо</b> ' : ''}${esc(clip(hero.title, 90))}</span></a>
</section>
${live.length ? `<section class="live" id="efir"><h2>Прямі ефіри цілодобово</h2><p class="sub">Музика без зупинки: вмикайте фоном удома, в машині чи на роботі.</p><div class="grid">${live.map(v => card(v, '')).join('\n')}</div></section>` : ''}
<section class="all" id="all"><h2>Нові та улюблені збірки</h2>${filters}
<div class="grid" id="grid">${shownHome.map(v => card(v, '')).join('\n')}</div>
<button type="button" class="btn more" id="more">Показати ще</button>
</section>
<section class="about"><h2>Музика, яку слухають у дорозі й удома</h2>
<div class="cols">${cfg.channels.map(c => `<div><h3><a href="${c.slug}/" style="--c:${c.color}">${esc(c.name)}</a></h3><p>${esc(c.about)}</p><a class="btn yt" href="${c.youtube}?sub_confirmation=1" target="_blank" rel="noopener">${icoYT}<span>Підписатися</span></a></div>`).join('')}</div>
</section>
</main>
${foot('')}`);

// ---------- 4. сторінки каналів ----------
for (const c of cfg.channels) {
  const list = videos.filter(v => v.tag === c.tag);
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: c.seo, url: `${BASE}/${c.slug}/`, inLanguage: 'uk',
    mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 50).map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/v/${v.id}/` })) } },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: SITE.name, item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: c.name, item: `${BASE}/${c.slug}/` }] }];
  write(`${c.slug}/index.html`, `${head({ title: `${c.seo} | слухати онлайн`, desc: `${c.about} ${list.length} збірок і прямі ефіри каналу ${c.name}.`, canon: `${BASE}/${c.slug}/`, rel: '../', img: thumb(list[0]?.id || hero.id), ld })}
<body class="chan" style="--c:${c.color}">
${bar('../', c.tag)}
<main>
<section class="chead"><h1>${esc(c.name)}: ${esc(c.seo.split('—')[0].trim().toLowerCase())}</h1><p class="lede">${esc(c.about)}</p>
<div class="follow">${playAll()}<button type="button" class="btn ghost" id="shuffle">Перемішати</button><a class="btn yt" href="${c.youtube}?sub_confirmation=1" target="_blank" rel="noopener">${icoYT}<span>Підписатися на ${esc(c.name)}</span></a>${SITE.telegram ? `<a class="btn tg" href="${SITE.telegram}" target="_blank" rel="noopener">${icoTG}<span>Наш Telegram</span></a>` : ''}</div>
</section>
<section class="all"><h2>Усі збірки ${esc(c.name)}</h2><div class="grid" id="grid">${list.map(v => card(v, '../')).join('\n')}</div><button type="button" class="btn more" id="more">Показати ще</button></section>
</main>
${foot('../')}`);
}

// ---------- 4б. «Найкращі» — найпопулярніші за переглядами ----------
{
  const top = regular.filter(v => v.views).sort((a, b) => b.views - a.views).slice(0, 90);
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Найпопулярніші українські пісні 2026', url: `${BASE}/best/`, inLanguage: 'uk',
    mainEntity: { '@type': 'ItemList', itemListElement: top.slice(0, 50).map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${BASE}/v/${v.id}/` })) } }];
  write('best/index.html', `${head({ title: 'Найпопулярніші українські пісні 2026 — топ збірок | UKR Hits', desc: 'Топ українських збірок за переглядами: музика в машину, пісні для душі та про кохання від VORON, МРІЄВА і GoldenWaveUA.', canon: `${BASE}/best/`, rel: '../', img: thumb(top[0]?.id || hero.id), ld })}
<body class="chan best">
${bar('../', 'best')}
<main>
<section class="chead"><h1>Найпопулярніші українські пісні</h1><p class="lede">Збірки, які слухають найбільше: від драйвових хітів у машину до ніжних пісень про кохання. Порядок — за кількістю переглядів на YouTube.</p><div class="follow">${playAll()}</div></section>
<section class="all"><h2>Топ ${top.length} збірок</h2><div class="grid" id="grid">${top.map(v => card(v, '../')).join('\n')}</div><button type="button" class="btn more" id="more">Показати ще</button></section>
</main>
${foot('../')}`);
}

// ---------- 5. сторінка кожного відео ----------
for (const v of videos) {
  const c = CH[v.tag];
  const same = videos.filter(x => x.tag === v.tag && x.id !== v.id);
  const i = same.findIndex(x => (x.published || '') < (v.published || ''));
  const rel = [...same.slice(Math.max(0, i - 4), Math.max(0, i - 4) + 8)].slice(0, 8);
  const ld = [{ '@context': 'https://schema.org', '@type': 'VideoObject', name: v.title, description: clip(lead(v.description) || `${v.title} — ${c.about}`, 300),
    thumbnailUrl: [thumb(v.id, 'maxresdefault'), thumb(v.id)], uploadDate: v.published || today, ...(v.sec ? { duration: v.duration } : {}),
    embedUrl: `https://www.youtube.com/embed/${v.id}`, url: `${BASE}/v/${v.id}/`, inLanguage: 'uk',
    ...(v.views ? { interactionStatistic: { '@type': 'InteractionCounter', interactionType: { '@type': 'WatchAction' }, userInteractionCount: v.views } } : {}),
    ...(v.live ? { publication: { '@type': 'BroadcastEvent', isLiveBroadcast: true, startDate: v.published } } : {}),
    author: { '@type': 'MusicGroup', name: c.name, url: c.youtube } },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: SITE.name, item: BASE + '/' }, { '@type': 'ListItem', position: 2, name: c.name, item: `${BASE}/${c.slug}/` }, { '@type': 'ListItem', position: 3, name: clip(v.title, 80), item: `${BASE}/v/${v.id}/` }] }];
  const songs = v.tr.length ? `<section class="songs"><h2>Пісні у збірці</h2><ol>${v.tr.map(([t, n]) => `<li><button type="button" class="at" data-t="${t}"><span class="tm">${hms(t)}</span> ${esc(n)}</button></li>`).join('')}</ol></section>` : '';
  const desc = `${v.tr.length ? 'Пісні: ' + v.tr.slice(0, 6).map(x => x[1]).join(', ') + '. ' : ''}${clip(lead(v.description), 150) || c.about}`;
  write(`v/${v.id}/index.html`, `${head({ title: `${clip(v.title, 70)} — слухати онлайн | ${c.name}`, desc: clip(desc, 160), canon: `${BASE}/v/${v.id}/`, rel: '../../', img: thumb(v.id, 'hqdefault'), ld, type: 'video.other' })}
<body class="video" style="--c:${c.color}">
${bar('../../', v.tag)}
<main>
<article class="vid">
<div class="player" data-id="${v.id}" data-s="${esc(shortT(v.title))}" data-tag="${v.tag}" data-c="${c.color}" data-live="${v.live ? 1 : 0}"><img src="${thumb(v.id, 'maxresdefault')}" onerror="this.onerror=null;this.src='${thumb(v.id)}'" alt="${esc(v.title)}" width="1280" height="720"><button type="button" class="play" aria-label="Слухати">${'<svg viewBox="0 0 68 48" width="88" height="62" aria-hidden="true"><rect width="68" height="48" rx="12" fill="#FF0000"/><path d="M27 15l18 9-18 9z" fill="#fff"/></svg>'}</button></div>
<h1>${esc(v.title)}</h1>
<p class="m"><a href="../../${c.slug}/" style="--c:${c.color}"><b>${esc(c.name)}</b></a>${v.live ? ' · <span class="onair">Наживо</span>' : ''}${v.sec && !v.live ? ' · ' + durWords(v.sec) : ''}${v.published && !v.live ? ' · ' + dateUa(v.published) : ''}${v.views ? ' · ' + views(v.views) : ''}</p>
<div class="follow"><a class="btn yt" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${icoYT}<span>Дивитися на YouTube</span></a><a class="btn yt" href="${c.youtube}?sub_confirmation=1" target="_blank" rel="noopener">${icoYT}<span>Підписатися на ${esc(c.name)}</span></a>${SITE.telegram ? `<a class="btn tg" href="${SITE.telegram}" target="_blank" rel="noopener">${icoTG}<span>Telegram</span></a>` : ''}</div>
${lead(v.description) ? `<div class="desc">${lead(v.description).split('\n').map(p => p.trim() ? `<p>${esc(p)}</p>` : '').join('')}</div>` : ''}
</article>
${songs}
${rel.length ? `<section class="more-vids"><h2>Ще від ${esc(c.name)}</h2><div class="grid">${rel.map(x => card(x, '../../')).join('\n')}</div></section>` : ''}
</main>
${foot('../../')}`);
}

// ---------- 5б. завершені ефіри й недоступні відео (45 днів): хто прийшов за старим посиланням — бачить, що грає зараз ----------
const keep = new Set(videos.map(v => v.id));
for (const v of gone) {
  const c = CH[v.tag];
  keep.add(v.id);
  const pick = [...live, ...regular.filter(x => x.tag === v.tag)].slice(0, 8);
  write(`v/${v.id}/index.html`, `${head({ title: `${v.stream ? 'Ефір завершився' : 'Відео недоступне'} — ${clip(v.title, 60)} | ${SITE.name}`, desc: `${v.stream ? 'Цей прямий ефір уже завершився' : 'Це відео більше недоступне'}. Слухайте нові збірки й прямі ефіри ${c.name} на ${SITE.name}.`, canon: `${BASE}/v/${v.id}/`, rel: '../../', img: thumb(v.id), robots: 'noindex, follow' })}
<body class="video gone" style="--c:${c.color}">
${bar('../../', v.tag)}
<main>
<article class="vid">
<p class="kicker">${v.stream ? 'Цей прямий ефір уже завершився' : 'Це відео більше недоступне'}</p>
<h1>${esc(v.title)}</h1>
<p class="lede">${v.stream ? 'YouTube не зберіг запис цього ефіру.' : 'Відео прибрали з YouTube.'} Нижче — що можна послухати просто зараз.</p>
<div class="follow"><a class="btn main" href="../../${c.slug}/">Усі збірки ${esc(c.name)}</a></div>
</article>
${pick.length ? `<section class="more-vids"><h2>Послухайте зараз</h2><div class="grid">${pick.map(x => card(x, '../../')).join('\n')}</div></section>` : ''}
</main>
${foot('../../')}`);
}
// теки відео, яких нема ні на сайті, ні серед недоступних, — прибрати (раніше лишалися назавжди)
for (const d of fs.readdirSync(path.join(ROOT, 'v'))) if (!keep.has(d) && /^[\w-]{11}$/.test(d)) fs.rmSync(path.join(ROOT, 'v', d), { recursive: true, force: true });

// ---------- 6. пошуковий індекс, карти сайту, robots, llms ----------
fs.writeFileSync(path.join(ROOT, 'search.json'), JSON.stringify(videos.map(v => [v.id, v.title, v.tag, v.tr.map(([t, n]) => [t, n]), v.live ? 1 : 0])));
const urls = [[`${BASE}/`, today], [`${BASE}/best/`, today], ...cfg.channels.map(c => [`${BASE}/${c.slug}/`, today]), ...videos.map(v => [`${BASE}/v/${v.id}/`, v.live ? today : (v.published || today).slice(0, 10)])];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `<url><loc>${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}\n</urlset>\n`);
write('video-sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${videos.slice(0, 1000).map(v => `<url><loc>${BASE}/v/${v.id}/</loc><video:video><video:thumbnail_loc>${thumb(v.id)}</video:thumbnail_loc><video:title>${esc(clip(v.title, 100))}</video:title><video:description>${esc(clip(lead(v.description) || CH[v.tag].about, 2000))}</video:description><video:player_loc>https://www.youtube.com/embed/${v.id}</video:player_loc>${v.sec && !v.live ? `<video:duration>${Math.min(v.sec, 28800)}</video:duration>` : ''}<video:publication_date>${v.published || today}</video:publication_date>${v.live ? '<video:live>yes</video:live>' : ''}</video:video></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\nSitemap: ${BASE}/video-sitemap.xml\n`);
write('llms.txt', `# ${SITE.full}\n\n> Сайт зі свіжими збірками українських пісень трьох YouTube-каналів: VORON (музика в машину), МРІЄВА (пісні для душі) і GoldenWaveUA (пісні про кохання). Оновлюється автоматично.\n\n${cfg.channels.map(c => `- [${c.name}](${BASE}/${c.slug}/): ${c.about}`).join('\n')}\n\n## Найновіші збірки\n${regular.slice(0, 30).map(v => `- [${v.title}](${BASE}/v/${v.id}/)`).join('\n')}\n`);
console.log(`готово: головна, ${cfg.channels.length} канали, ${videos.length} сторінок відео (наживо: ${live.length}), завершених/недоступних: ${gone.length}`);
