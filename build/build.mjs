// build.mjs — генератор сайту ukr-hits.online
// Тягне свіжі відео з YouTube-лент (RSS) усіх каналів, впікає їх у статичний
// index.html (добре для SEO та AI-пошуку), перемішування робиться у браузері.
// Запуск: node build/build.mjs   (Node 18+, без залежностей)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const cfg = JSON.parse(readFileSync(join(__dirname, 'channels.json'), 'utf8'));
const SITE = cfg.site;

const MAX_PER_CHANNEL = 14;   // скільки відео з кожного каналу
const MAX_TOTAL = 42;         // загальний максимум на сторінці
const NEW_DAYS = 21;          // позначка «Нове», якщо відео свіже

// ---------- утиліти ----------
function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
          .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cleanTitle(t) {
  // прибираємо зайві емодзі-сміття на краях, подвійні пробіли
  return decodeXml(t).replace(/\s+/g, ' ').trim();
}

async function fetchFeed(ch) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UkrHitsBot/1.0)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    const entries = xml.split('<entry>').slice(1);
    const out = [];
    for (const e of entries) {
      const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
      const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
      if (!id || !title) continue;
      out.push({
        id,
        title: cleanTitle(title),
        published: pub || '',
        channel: ch.name,
        label: ch.label,
        tag: ch.tag,
        accent: ch.accent,
      });
    }
    return out.slice(0, MAX_PER_CHANNEL);
  } catch (err) {
    console.error(`! Канал ${ch.name} (${ch.id}) не завантажився: ${err.message}`);
    return [];
  }
}

// ---------- збір відео ----------
const lists = await Promise.all(cfg.channels.map(fetchFeed));
let videos = [];
const seen = new Set();
for (const list of lists) {
  for (const v of list) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    videos.push(v);
  }
}
// найсвіжіші зверху (порядок у HTML; у браузері все одно перемішується)
videos.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
videos = videos.slice(0, MAX_TOTAL);

if (videos.length === 0) {
  console.error('Жодного відео не отримано — лишаю поточний index.html без змін.');
  process.exit(0);
}

const now = new Date();
const today = now.toISOString().slice(0, 10);
const isNew = (p) => p && (now - new Date(p)) / 86400000 < NEW_DAYS;

// ---------- картки ----------
function card(v) {
  const t = escHtml(v.title);
  const badge = isNew(v.published)
    ? `<span class="badge new">Нове</span>` : '';
  return `<a class="c" data-tag="${v.tag}" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener" title="${t}">
<div class="th"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="${t}" width="320" height="180" loading="lazy">
${badge}<span class="ch" style="--a:${v.accent}">${escHtml(v.label)}</span>
<span class="pl" aria-hidden="true"><svg viewBox="0 0 68 48"><path d="M66.5 7.7s-.7-4.7-2.8-6.8C60.7-2 57.2-2 55.6-2.2 46.4-3 34-3 34-3s-12.4 0-21.6.8C10.8-2 7.3-2 4.3.9 2.2 3 1.5 7.7 1.5 7.7S.8 13.2.8 18.7v5.1c0 5.5.7 11 .7 11s.7 4.7 2.8 6.8c3 2.9 6.9 2.8 8.6 3.1 6.3.6 26.1.8 26.1.8s12.4 0 21.6-.8c1.6-.2 5.1-.2 8.1-3.1 2.1-2.1 2.8-6.8 2.8-6.8s.7-5.5.7-11v-5.1c0-5.5-.7-11-.7-11z" fill="red"/><path d="M27 32l18-11-18-11z" fill="#fff"/></svg></span></div>
<div class="ct">${t}</div></a>`;
}
const cardsHtml = videos.map(card).join('\n      ');

// ---------- чіпи фільтра ----------
const chips = [`<button class="chip active" data-tag="all">Усі пісні</button>`]
  .concat(cfg.channels.map(c => `<button class="chip" data-tag="${c.tag}" style="--a:${c.accent}">${escHtml(c.label)}</button>`))
  .join('');

// ---------- JSON-LD ----------
const itemList = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Українські пісні — слухати онлайн',
  numberOfItems: videos.length,
  itemListElement: videos.map((v, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'VideoObject',
      name: v.title,
      description: `Українська пісня «${v.title}» від каналу ${v.channel}. Слухати онлайн безкоштовно на ukr-hits.online.`,
      thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      uploadDate: v.published || today,
      contentUrl: `https://www.youtube.com/watch?v=${v.id}`,
      embedUrl: `https://www.youtube.com/embed/${v.id}`,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      inLanguage: 'uk',
      isFamilyFriendly: true,
      publisher: { '@type': 'Organization', name: v.channel },
    },
  })),
};
const faq = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    ['Де слухати українську музику онлайн безкоштовно?', 'На сайті ukr-hits.online можна слухати українську музику онлайн безкоштовно, без реєстрації та без реклами. Збірки оновлюються щодня з наших YouTube-каналів GoldenWaveUA, VORON і Рок Українською.'],
    ['Які сучасні українські хіти зараз популярні?', 'Серед популярних — нові пісні 2025-2026 від українських артистів: романтичні балади, драйвова музика в машину та сучасний український рок. Свіжі релізи додаються автоматично щодня.'],
    ['Чи можна слухати українські пісні без реклами?', 'Так. На ukr-hits.online музика грає без реклами, без підписки та повністю безкоштовно прямо у браузері. Сайт можна встановити як застосунок на телефон.'],
    ['Як знайти українські пісні в машину?', 'У добірці ukr-hits.online зібрані найкращі енергійні українські пісні в машину — драйвові треки для подорожей. Відкрийте розділ і вмикайте через Bluetooth.'],
    ['Звідки беруться пісні на сайті?', 'Усі пісні — це офіційні відео з українських YouTube-каналів проєкту (GoldenWaveUA, VORON, Рок Українською). Сайт легально веде на оригінальні відео й підтримує артистів переглядами.'],
  ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
};
const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE.name,
  url: SITE.url + '/',
  description: 'Слухати українську музику онлайн безкоштовно — сучасні українські хіти 2025-2026.',
  inLanguage: 'uk',
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: SITE.url + '/?q={search_term_string}' },
    'query-input': 'required name=search_term_string',
  },
};

// ---------- HTML ----------
const html = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0b0e14" />

  <title>Українські пісні слухати онлайн безкоштовно 2025-2026 | Сучасні хіти</title>
  <meta name="description" content="Слухати українську музику онлайн безкоштовно. Найкращі українські пісні 2025-2026: сучасні хіти, нові пісні в машину, романтика та український рок. Без реклами, оновлюється щодня." />
  <meta name="keywords" content="українські пісні, слухати музику онлайн, українська музика, сучасні українські хіти, слухати українську музику безкоштовно, українські пісні слухати онлайн безкоштовно, музика в машину, нові українські пісні 2026, збірка українських пісень" />
  <link rel="canonical" href="${SITE.url}/" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />

  <meta property="og:type" content="website" />
  <meta property="og:title" content="Українські пісні — Слухати онлайн безкоштовно 2025-2026" />
  <meta property="og:description" content="Сучасна українська музика: хіти, нові пісні, романтика, музика в машину та рок. Слухайте безкоштовно — оновлюється щодня!" />
  <meta property="og:url" content="${SITE.url}/" />
  <meta property="og:image" content="${SITE.url}/social-share.jpg" />
  <meta property="og:locale" content="uk_UA" />
  <meta property="og:site_name" content="UKR Hits — Українська музика онлайн" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Українські пісні — Слухати онлайн безкоштовно" />
  <meta name="twitter:description" content="Сучасні українські хіти 2025-2026. Слухайте найкращу українську музику безкоштовно!" />
  <meta name="twitter:image" content="${SITE.url}/social-share.jpg" />

  <link rel="preconnect" href="https://i.ytimg.com" crossorigin />
  <link rel="dns-prefetch" href="https://i.ytimg.com" />
  <link rel="icon" href="/favicon.svg?v=3" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icon-512.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="alternate" hreflang="uk" href="${SITE.url}/" />
  <link rel="alternate" hreflang="x-default" href="${SITE.url}/" />

  <script type="application/ld+json">${JSON.stringify(website)}</script>
  <script type="application/ld+json">${JSON.stringify(itemList)}</script>
  <script type="application/ld+json">${JSON.stringify(faq)}</script>

  <style>
    :root{--bg:#0a0d13;--bg2:#0e131c;--card:#141a25;--card-h:#1c2433;--text:#eef3f9;--muted:#9aabc2;--line:rgba(255,255,255,.07);--tg:#27a7e7;--g1:#7c5cff;--g2:#22d3ee;--g3:#ff7eb6}
    *{box-sizing:border-box;margin:0}
    html{scroll-behavior:smooth}
    body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;overflow-x:hidden;-webkit-font-smoothing:antialiased}
    body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(900px 500px at 12% -8%,rgba(124,92,255,.18),transparent 60%),radial-gradient(800px 500px at 100% 0%,rgba(34,211,238,.12),transparent 55%),radial-gradient(700px 600px at 50% 120%,rgba(255,126,182,.10),transparent 60%)}
    a{color:inherit;text-decoration:none}
    .wrap{max-width:1240px;margin:0 auto;padding:0 18px}

    header.nav{position:sticky;top:0;z-index:50;backdrop-filter:blur(14px);background:rgba(10,13,19,.72);border-bottom:1px solid var(--line)}
    .nav .row{display:flex;align-items:center;justify-content:space-between;height:60px}
    .logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:.2px}
    .logo .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--g1),var(--g2));display:flex;align-items:center;justify-content:center;font-size:16px}
    .logo b{background:linear-gradient(90deg,#fff,var(--muted));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    .nav-ico{display:flex;gap:8px}
    .nav-ico a{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);border:1px solid var(--line);transition:.25s}
    .nav-ico a:hover{background:rgba(255,255,255,.1);transform:translateY(-2px)}
    .nav-ico svg{width:18px;height:18px}

    .hero{text-align:center;padding:54px 0 26px}
    .pill{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--line);padding:6px 14px;border-radius:999px;margin-bottom:18px}
    .pill i{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399;font-style:normal}
    h1{font-size:clamp(28px,6vw,52px);line-height:1.08;font-weight:850;letter-spacing:-.5px;margin-bottom:16px}
    h1 span{background:linear-gradient(90deg,var(--g1),var(--g3),var(--g2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    .sub{color:var(--muted);font-size:clamp(15px,2.2vw,18px);max-width:680px;margin:0 auto 24px;line-height:1.55}
    .cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
    .btn{display:inline-flex;align-items:center;gap:9px;padding:13px 24px;border-radius:14px;font-weight:700;font-size:15px;cursor:pointer;border:0;transition:.25s}
    .btn.primary{background:linear-gradient(135deg,var(--g1),var(--g2));color:#0a0d13}
    .btn.primary:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(124,92,255,.35)}
    .btn.ghost{background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--text)}
    .btn.ghost:hover{background:rgba(255,255,255,.12)}

    .chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:30px 0 8px}
    .chip{font:inherit;font-size:14px;font-weight:600;color:var(--muted);padding:9px 18px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid var(--line);cursor:pointer;transition:.22s}
    .chip:hover{color:#fff;border-color:rgba(255,255,255,.2)}
    .chip.active{color:#0a0d13;background:linear-gradient(135deg,#fff,#cbd5e1);border-color:transparent}
    .chip[data-tag]:not([data-tag="all"]).active{background:var(--a,#fff);color:#0a0d13}

    .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 14px;flex-wrap:wrap}
    .bar h2{font-size:18px;font-weight:700;display:flex;align-items:center;gap:9px}
    .bar h2::before{content:"";width:4px;height:20px;border-radius:3px;background:linear-gradient(var(--g1),var(--g2))}
    .shuf{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--line);padding:9px 16px;border-radius:12px;cursor:pointer;transition:.22s}
    .shuf:hover{color:#fff;border-color:rgba(255,255,255,.25);transform:translateY(-1px)}
    .shuf svg{width:16px;height:16px}

    .g{display:grid;gap:16px;grid-template-columns:repeat(2,1fr)}
    @media(min-width:640px){.g{grid-template-columns:repeat(3,1fr)}}
    @media(min-width:1000px){.g{grid-template-columns:repeat(4,1fr)}}
    .c{display:block;background:var(--card);border-radius:16px;overflow:hidden;border:1px solid var(--line);transition:.25s}
    .c:hover{transform:translateY(-5px);background:var(--card-h);border-color:rgba(124,92,255,.3)}
    .th{position:relative;aspect-ratio:16/9;background:#0c0f16;overflow:hidden}
    .th img{width:100%;height:100%;object-fit:cover;transition:transform .45s}
    .c:hover .th img{transform:scale(1.06)}
    .pl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:.25s;background:rgba(0,0,0,.18)}
    .c:hover .pl{opacity:1}
    .pl svg{width:50px;height:50px;filter:drop-shadow(0 3px 10px rgba(0,0,0,.6))}
    .ch{position:absolute;left:8px;bottom:8px;font-size:11px;font-weight:800;color:#0a0d13;background:var(--a,#fff);padding:3px 9px;border-radius:7px;letter-spacing:.2px}
    .badge.new{position:absolute;top:8px;right:8px;font-size:10px;font-weight:800;color:#0a0d13;background:#fde047;padding:3px 8px;border-radius:6px}
    .ct{padding:12px 13px;font-size:13.5px;font-weight:500;line-height:1.4;height:60px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

    .faq{margin-top:54px}
    .faq h2{text-align:center;font-size:24px;font-weight:800;margin-bottom:22px}
    .fi{background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:14px;margin-bottom:10px;overflow:hidden}
    .fq{padding:16px 18px;cursor:pointer;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px}
    .fq::after{content:"+";font-size:20px;color:var(--g2);transition:.3s;flex-shrink:0}
    .fi.open .fq::after{transform:rotate(45deg)}
    .fa{max-height:0;overflow:hidden;transition:max-height .3s}
    .fi.open .fa{max-height:260px}
    .fa p{color:var(--muted);line-height:1.65;margin:0;padding:0 18px 16px;font-size:14.5px}

    .seo{margin-top:54px;padding:30px;background:rgba(255,255,255,.025);border:1px solid var(--line);border-radius:22px;color:var(--muted);line-height:1.7;font-size:14.5px}
    .seo h2,.seo h3{color:var(--text);margin:22px 0 10px;line-height:1.3}
    .seo h2{font-size:22px}.seo h3{font-size:17px}.seo h2:first-child{margin-top:0}
    .seo ul{padding-left:20px;margin:8px 0}.seo li{margin-bottom:7px}
    .seo strong{color:#dbe6f3}

    .socials{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:42px 0 8px}
    .sb{background:rgba(255,255,255,.05);padding:11px 20px;border-radius:12px;border:1px solid var(--line);font-weight:600;font-size:14px;transition:.25s}
    .sb:hover{background:rgba(255,255,255,.1);transform:translateY(-2px)}
    .ft{text-align:center;padding:36px 0;margin-top:24px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;line-height:1.8}
    .ft a{color:var(--g2)}

    .ib{position:fixed;right:18px;bottom:18px;background:linear-gradient(135deg,var(--g1),var(--g2));color:#0a0d13;padding:13px 22px;border-radius:14px;font-weight:800;cursor:pointer;z-index:40;font-size:14px;box-shadow:0 10px 28px rgba(124,92,255,.4);transition:.25s}
    .ib:hover{transform:scale(1.05)}
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(12px);z-index:200;align-items:center;justify-content:center;padding:20px}
    .modal.active{display:flex}
    .mc{background:var(--bg2);max-width:440px;width:100%;border-radius:24px;padding:26px;position:relative;border:1px solid var(--line)}
    .mx{position:absolute;top:14px;right:16px;font-size:24px;cursor:pointer;color:var(--muted)}
    .ms{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start}
    .mn{background:linear-gradient(135deg,var(--g1),var(--g2));color:#0a0d13;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:800;font-size:13px}
    .ms b{color:#fff;display:block;margin-bottom:2px;font-size:14px}
  </style>
</head>
<body>

  <header class="nav">
    <div class="wrap row">
      <a class="logo" href="/"><span class="dot">🎵</span> <b>UKR&nbsp;Hits</b></a>
      <nav class="nav-ico">
        <a href="${SITE.telegram}" target="_blank" rel="noopener" title="Telegram"><svg viewBox="0 0 24 24" fill="#27a7e7"><path d="M9.999 15.2l-.4 5.6c.57 0 .82-.24 1.12-.54l2.7-2.59 5.6 4.1c1.03.57 1.76.27 2.03-.95l3.68-17.25C24.78.84 23.9.24 22.9.61L1.48 9.23C-.02 9.82-.01 10.7 1.21 11.08l5.63 1.76L19.3 5.58c.65-.43 1.24-.19.76.24z"/></svg></a>
        <a href="https://www.youtube.com/channel/UCXN8Ibh2QGNwZSwFJH423aw" target="_blank" rel="noopener" title="YouTube GoldenWaveUA"><svg viewBox="0 0 24 24" fill="#ff0033"><path d="M23.5 6.2s-.2-1.6-1-2.3c-.9-.9-1.9-.9-2.4-1C16.8 2.5 12 2.5 12 2.5s-4.8 0-8.1.4c-.5.1-1.5.1-2.4 1-.7.7-1 2.3-1 2.3S.3 8.1.3 10v1.8c0 1.9.2 3.8.2 3.8s.2 1.6 1 2.3c.9.9 2.1.9 2.6 1 1.9.2 8 .2 8 .2s4.8 0 8.1-.3c.5-.1 1.5-.1 2.4-1 .7-.7 1-2.3 1-2.3s.2-1.9.2-3.8V10c0-1.9-.2-3.8-.2-3.8zM9.6 15.5V8l6.5 3.8-6.5 3.7z"/></svg></a>
        <a href="${SITE.tiktok}" target="_blank" rel="noopener" title="TikTok"><svg viewBox="0 0 24 24" fill="#fff"><path d="M21 8.1a6.7 6.7 0 0 1-4.2-1.45v7.01a5.56 5.56 0 1 1-5.56-5.56 5.5 5.5 0 0 1 1.6.24v2.64a2.9 2.9 0 1 0 2.03 2.77V2h2.4a4.3 4.3 0 0 0 3.73 3.7v2.4Z"/></svg></a>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <section class="hero">
      <span class="pill"><i></i> Оновлюється щодня · ${videos.length} пісень</span>
      <h1>Українські пісні —<br><span>слухати онлайн безкоштовно</span></h1>
      <p class="sub">Найкращі <strong>сучасні українські хіти 2025-2026</strong>: нові пісні, романтика, музика в машину та український рок. Без реклами, без реєстрації.</p>
      <div class="cta-row">
        <a class="btn primary" href="#music">▶ Слухати зараз</a>
        <a class="btn ghost" href="${SITE.telegram}" target="_blank" rel="noopener">Музика в Telegram</a>
      </div>
    </section>

    <div class="chips" id="chips">${chips}</div>

    <div class="bar" id="music">
      <h2>Слухати українську музику</h2>
      <button class="shuf" id="shuffle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Перемішати</button>
    </div>

    <div class="g" id="grid">
      ${cardsHtml}
    </div>

    <section class="faq">
      <h2>Часті запитання</h2>
      <div class="fi"><div class="fq">Де слухати українську музику онлайн безкоштовно?</div><div class="fa"><p>На <strong>ukr-hits.online</strong> ви слухаєте українську музику онлайн безкоштовно, без реєстрації та без реклами. Збірки оновлюються щодня з YouTube-каналів GoldenWaveUA, VORON і Рок Українською.</p></div></div>
      <div class="fi"><div class="fq">Які сучасні українські хіти зараз популярні?</div><div class="fa"><p>Нові пісні 2025-2026 від українських артистів: романтичні балади, драйвова музика в машину та сучасний український рок. Свіжі релізи з’являються автоматично щодня.</p></div></div>
      <div class="fi"><div class="fq">Чи можна слухати пісні без реклами?</div><div class="fa"><p>Так! На ukr-hits.online музика грає без реклами, без підписки та безкоштовно прямо у браузері. Сайт можна встановити як застосунок на телефон.</p></div></div>
      <div class="fi"><div class="fq">Як знайти українські пісні в машину?</div><div class="fa"><p>У добірці зібрані найкращі енергійні українські пісні для подорожей. Натисніть «Перемішати», увімкніть трек і слухайте через Bluetooth у машині.</p></div></div>
      <div class="fi"><div class="fq">Звідки беруться пісні на сайті?</div><div class="fa"><p>Це офіційні відео з наших українських YouTube-каналів. Сайт легально веде на оригінали й підтримує артистів переглядами.</p></div></div>
    </section>

    <section class="seo">
      <h2>Українська музика онлайн — слухати безкоштовно 2025-2026</h2>
      <p><strong>ukr-hits.online</strong> — це місце, де можна <strong>слухати українські пісні онлайн безкоштовно</strong>. Ми щодня збираємо найкращу <strong>збірку української музики</strong>: нові хіти, романтичні балади, драйвові треки в машину та сучасний український рок з наших YouTube-каналів.</p>
      <h3>Що ви знайдете на сайті?</h3>
      <ul>
        <li><strong>Сучасні українські хіти 2025-2026</strong> — найпопулярніші нові пісні</li>
        <li><strong>Українські пісні в машину</strong> — енергійні драйвові треки для подорожей</li>
        <li><strong>Романтична українська музика</strong> — ніжні пісні про кохання та для душі</li>
        <li><strong>Український рок</strong> — сучасні гурти та потужні гітарні треки</li>
        <li><strong>Збірки для настрою</strong> — тематичні плейлисти на кожен день</li>
      </ul>
      <h3>Чому варто слухати тут?</h3>
      <p>Колекція <strong>оновлюється автоматично щодня</strong>, а пісні щоразу перемішуються — тож щоразу ви відкриваєте нову добірку. Усе безкоштовно, без реклами та реєстрації. Слухайте улюблену <strong>українську музику онлайн</strong> з телефона чи комп’ютера й підтримуйте українських артистів.</p>
    </section>

    <div class="socials">
      <a class="sb" href="${SITE.spotify}" target="_blank" rel="noopener">Spotify</a>
      <a class="sb" href="${SITE.facebook}" target="_blank" rel="noopener">Facebook</a>
      <a class="sb" href="${SITE.telegram}" target="_blank" rel="noopener">Telegram</a>
      <a class="sb" href="${SITE.tiktok}" target="_blank" rel="noopener">TikTok</a>
    </div>

    <footer class="ft">
      <p>&copy; 2026 <a href="/">ukr-hits.online</a> — Українська музика онлайн безкоштовно</p>
      <p><a href="/about.html">Про проєкт</a> · Оновлено: ${today}</p>
    </footer>
  </main>

  <div class="ib" id="openModal">⬇ Встановити</div>
  <div class="modal" id="modal">
    <div class="mc">
      <div class="mx" id="closeModal">&times;</div>
      <h2 style="margin-top:0;font-size:20px">Встановити на телефон</h2>
      <p style="color:var(--muted);margin:8px 0 18px;font-size:14px">Додайте сайт на головний екран — відкриватиметься як застосунок:</p>
      <div class="ms"><div class="mn">1</div><div><b>iPhone (Safari)</b><span style="color:var(--muted);font-size:13px"> — кнопка «Поділитися»</span></div></div>
      <div class="ms"><div class="mn">2</div><div><b>Android (Chrome)</b><span style="color:var(--muted);font-size:13px"> — меню «три крапки»</span></div></div>
      <div class="ms"><div class="mn">3</div><div><b>Далі</b><span style="color:var(--muted);font-size:13px"> — «Додати на головний екран»</span></div></div>
      <button class="btn primary" style="width:100%;margin-top:8px;justify-content:center" id="closeModalBtn">Зрозуміло!</button>
    </div>
  </div>

  <script>
    (function(){
      var grid=document.getElementById('grid');
      function shuffleGrid(){
        var vis=[],hid=[];
        [].forEach.call(grid.children,function(c){ (c.style.display==='none'?hid:vis).push(c); });
        for(var i=vis.length-1;i>0;i--){var j=(Math.random()*(i+1))|0;var t=vis[i];vis[i]=vis[j];vis[j]=t;}
        var f=document.createDocumentFragment();
        vis.concat(hid).forEach(function(el){f.appendChild(el);});
        grid.appendChild(f);
      }
      shuffleGrid();
      var sh=document.getElementById('shuffle');
      if(sh) sh.onclick=function(){ shuffleGrid(); window.scrollTo({top:document.getElementById('music').offsetTop-70,behavior:'smooth'}); };

      var chips=document.querySelectorAll('#chips .chip');
      [].forEach.call(chips,function(chip){
        chip.onclick=function(){
          [].forEach.call(chips,function(c){c.classList.remove('active');});
          chip.classList.add('active');
          var tag=chip.getAttribute('data-tag');
          [].forEach.call(grid.children,function(c){
            c.style.display=(tag==='all'||c.getAttribute('data-tag')===tag)?'':'none';
          });
        };
      });

      document.addEventListener('click',function(e){var q=e.target.closest('.fq');if(q)q.parentElement.classList.toggle('open');});

      var m=document.getElementById('modal');
      document.getElementById('openModal').onclick=function(){m.classList.add('active');};
      document.getElementById('closeModal').onclick=function(){m.classList.remove('active');};
      document.getElementById('closeModalBtn').onclick=function(){m.classList.remove('active');};
      window.addEventListener('click',function(e){if(e.target===m)m.classList.remove('active');});
    })();
  </script>
</body>
</html>
`;

writeFileSync(join(ROOT, 'index.html'), html);

// videos.json (для прозорості / можливого повторного використання)
writeFileSync(join(ROOT, 'videos.json'), JSON.stringify({ updated: now.toISOString(), count: videos.length, videos }, null, 2));

// sitemap.xml
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE.url}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${SITE.url}/about.html</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>
</urlset>
`;
writeFileSync(join(ROOT, 'sitemap.xml'), sitemap);

// video-sitemap.xml (Google Video)
const vsm = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${SITE.url}/</loc>
${videos.map(v => `    <video:video>
      <video:thumbnail_loc>https://i.ytimg.com/vi/${v.id}/hqdefault.jpg</video:thumbnail_loc>
      <video:title>${escHtml(v.title)}</video:title>
      <video:description>${escHtml('Українська пісня «' + v.title + '» — слухати онлайн безкоштовно на ukr-hits.online.')}</video:description>
      <video:player_loc>https://www.youtube.com/embed/${v.id}</video:player_loc>
      <video:publication_date>${(v.published || today)}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
      <video:live>no</video:live>
    </video:video>`).join('\n')}
  </url>
</urlset>
`;
writeFileSync(join(ROOT, 'video-sitemap.xml'), vsm);

console.log(`OK: ${videos.length} відео · index.html, videos.json, sitemap.xml, video-sitemap.xml оновлено (${today}).`);
