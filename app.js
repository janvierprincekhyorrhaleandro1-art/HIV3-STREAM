/* HIV3-STREAM — app.js
 * Main SPA engine for the supplied Moviebox API.
 * API routes: /home, /movies, /tv-series, /animation,
 * /search/suggest, /search, /detail/{slug},
 * /api/stream/{subject_id}, /api/stream/{subject_id}/captions
 * The supplied API has no /downloads endpoint.
 */
(() => {
  'use strict';

  const HIV3 = {
    base: window.HIV3_API_BASE_URL || localStorage.getItem('HIV3_API_BASE_URL') || 'https://hiv3-stream.onrender.com',
    page: 1,
    category: 'home',
    detail: null,
    searchTimer: null,
    controller: null
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const val = (...v) => v.find(x => x !== undefined && x !== null && String(x).trim() !== '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const url = (path, params = {}) => {
    const u = new URL(`${HIV3.base.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`);
    Object.entries(params).forEach(([k,v]) => { if (v !== '' && v !== null && v !== undefined) u.searchParams.set(k, v); });
    return u.toString();
  };

  async function api(path, params = {}) {
    if (HIV3.controller) HIV3.controller.abort();
    HIV3.controller = new AbortController();
    const timer = setTimeout(() => HIV3.controller.abort(), 20000);
    try {
      const r = await fetch(url(path, params), { headers: { Accept: 'application/json' }, signal: HIV3.controller.signal });
      if (!r.ok) throw new Error(`API ${r.status}: ${await r.text().catch(() => '')}`.slice(0, 240));
      const type = r.headers.get('content-type') || '';
      return type.includes('json') ? r.json() : r.text();
    } finally { clearTimeout(timer); }
  }

  function item(raw = {}) {
    const x = raw.subject || raw.movie || raw.data || raw;
    return {
      raw: x,
      name: val(x.name, x.title, x.subject_name, x.movie_name, 'Untitled'),
      title: val(x.name, x.title, x.subject_name, x.movie_name, 'Untitled'),
      poster: val(x.poster_url, x.poster, x.cover, x.cover_url, x.thumbnail, x.image, ''),
      backdrop: val(x.backdrop_url, x.backdrop, x.banner_url, x.banner, x.cover_url, x.poster_url, ''),
      slug: val(x.slug, x.detail_slug, ''),
      subjectId: val(x.subject_id, x.subjectId, x.id, x.movie_id, ''),
      rating: val(x.rating, x.score, x.imdb_rating, ''),
      year: val(x.year, x.release_year, ''),
      genre: Array.isArray(x.genres) ? x.genres.join(' · ') : val(x.genre, ''),
      description: val(x.description, x.synopsis, x.overview, x.introduction, '')
    };
  }

  function items(data) {
    if (Array.isArray(data)) return data.map(item);
    for (const x of [data?.items, data?.results, data?.data, data?.subjects, data?.movies, data?.tv_series, data?.animation]) {
      if (Array.isArray(x)) return x.map(item);
    }
    return [];
  }

  function sections(data) {
    if (Array.isArray(data)) return data;
    return [data?.sections, data?.data?.sections, data?.operatingList, data?.data].find(Array.isArray) || [];
  }

  function sectionType(s) { return String(val(s?.section, s?.type, s?.module, s?.name, '')).toUpperCase(); }
  function sectionItems(s) { return items({ items: val(s?.items, s?.list, s?.data, s?.subjects) }); }

  function showView(name) {
    const valid = ['home','search','category','downloads','profile','watch'];
    if (!valid.includes(name)) name = 'home';
    $$('.spa-view').forEach(v => { v.hidden = v.id !== `${name}-view`; v.classList.toggle('active', v.id === `${name}-view`); });
    if (!$('.spa-view')) ['home','search','category','downloads','profile','watch'].forEach(id => { const e = document.getElementById(id); if (e) e.hidden = id !== name; });
    $$('[data-spa], .hiv3-nav-item').forEach(b => b.classList.toggle('active', (b.dataset.spa || b.dataset.action) === name));
    HIV3.category = name;
    if (location.hash !== `#${name}`) history.replaceState({hiv3:true}, '', `#${name}`);
  }

  function navigate(name) { showView(name); window.scrollTo({top:0, behavior:'smooth'}); }

  function loading(c, text = 'Loading...') { if (c) c.innerHTML = `<div class="hiv3-loading"><p>${esc(text)}</p></div>`; }
  function error(c, text) { if (c) c.innerHTML = `<div class="hiv3-error"><strong>HIV3 could not load this content.</strong><p>${esc(text || 'Unknown error')}</p><button data-hiv3-retry>Try again</button></div>`; }

  function card(x, rank = null) {
    return `<article class="movie-card hiv3-api-card" data-slug="${esc(x.slug)}" data-subject-id="${esc(x.subjectId)}" tabindex="0" role="button">
      <div class="poster">${x.poster ? `<img src="${esc(x.poster)}" alt="${esc(x.title)}" loading="lazy">` : '<div class="poster-fallback">HIV3</div>'}
      ${rank !== null ? `<span class="rank">${rank + 1}</span>` : ''}${x.rating ? `<span class="hiv3-rating">${esc(x.rating)}</span>` : ''}</div>
      <h3>${esc(x.title)}</h3><p>${x.year ? `${esc(x.year)} · ` : ''}${esc(x.genre || 'Movie')}</p>
    </article>`;
  }

  function render(c, list, ranked = false) {
    if (!c) return;
    c.innerHTML = list.length ? list.map((x,i) => card(x, ranked ? i : null)).join('') : '<div class="hiv3-empty"><p>No content found.</p></div>';
    bindCards(c);
  }

  function bindCards(root = document) {
    $$('.hiv3-api-card', root).forEach(c => {
      if (c.dataset.bound) return;
      const open = () => c.dataset.slug ? openDetail(c.dataset.slug) : c.dataset.subjectId ? openWatch({subjectId:c.dataset.subjectId,title:$('h3',c)?.textContent || 'Playing'}) : null;
      c.addEventListener('click', open); c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }); c.dataset.bound = '1';
    });
  }

  async function loadHome() {
    navigate('home');
    const trend = $('#trending-container'), popular = $('#popular-container'), cont = $('#continue-container, #continue-watching-container');
    [trend,popular].forEach(c => loading(c));
    if (!HIV3.base) {
      const msg = 'API URL not configured yet. Deploy the FastAPI backend on Render, then set HIV3_API_BASE_URL.';
      [trend,popular].forEach(c => error(c,msg));
      return null;
    }
    try {
      const data = await api('/home');
      const ss = sections(data);
      const banner = ss.find(s => sectionType(s).includes('BANNER'));
      const movies = sectionItems(ss.find(s => sectionType(s).includes('SUBJECTS_MOVIE')));
      const tv = sectionItems(ss.find(s => sectionType(s).includes('SUBJECTS_TV')));
      const anim = sectionItems(ss.find(s => sectionType(s).includes('SUBJECTS_ANIMATION')));
      const all = [...movies, ...tv, ...anim];
      render(trend, all.slice(0,12), true); render(popular, movies.slice(0,12));
      if (cont) cont.innerHTML = '<div class="hiv3-empty"><p>Your watch history will appear here.</p></div>';
      renderHero(banner ? sectionItems(banner)[0] : all[0]);
      return {data, movies, tv, animation:anim, all};
    } catch(e) { console.error(e); [trend,popular].forEach(c => error(c,e.message)); return null; }
  }

  function renderHero(x) {
    if (!x) return;
    const hero = $('.hero, .home-hero'); if (!hero) return;
    const img = $('.hero-image',hero), title = $('.hero-title, h1',hero), copy = $('.hero-copy, .hero-description',hero), meta = $('.hero-meta',hero);
    if (img && x.backdrop) { img.src=x.backdrop; img.alt=x.title; }
    if (title) title.textContent=x.title;
    if (copy && x.description) copy.textContent=x.description;
    if (meta) meta.textContent=[x.year,x.genre,x.rating ? `★ ${x.rating}` : ''].filter(Boolean).join('  •  ');
    $$('[data-action="play"], .primary-action',hero).forEach(b => b.onclick=()=>x.slug?openDetail(x.slug):openWatch(x));
    $$('[data-action="details"], .secondary-action',hero).forEach(b => b.onclick=()=>x.slug?openDetail(x.slug):openWatch(x));
  }

  async function loadCategory(category, page=1, sort='') {
    if (category === 'home') return loadHome();
    if (category === 'trending') { const h=await loadHome(); return h?.all || []; }
    const paths = {movies:'/movies','tv-series':'/tv-series',animation:'/animation'};
    if (!paths[category]) return [];
    navigate('category');
    const c = $('#category-container, #category-results, #category-grid, #movie-grid'); loading(c,'Loading titles...');
    try { const data=await api(paths[category],{page,sort}); const list=items(data); render(c,list); return list; }
    catch(e){ error(c,e.message); return []; }
  }

  async function suggest(q) { if (!q.trim() || !HIV3.base) return []; try { return items(await api('/search/suggest',{q:q.trim()})); } catch(e){ console.error(e); return []; } }
  async function search(q,page=1) {
    q=String(q||'').trim(); if(!q)return [];
    if (!HIV3.base) { const c=$('#search-results, #search-container, #search-grid'); error(c,'API URL not configured yet.'); return []; }
    navigate('search'); const c=$('#search-results, #search-container, #search-grid'); loading(c,`Searching for "${q}"...`);
    try { const list=items(await api('/search',{q,page})); render(c,list); return list; } catch(e){ error(c,e.message); return []; }
  }

  async function getDetail(slug) { return api(`/detail/${encodeURIComponent(slug)}`); }
  function normalizeDetail(data) {
    const x=data?.data || data?.detail || data || {}, b=item(x);
    const gs=x.genres || x.genre_list || x.genre || [], genres=Array.isArray(gs)?gs:String(gs).split(',').map(s=>s.trim()).filter(Boolean);
    return {...b, genres, episodes:Array.isArray(x.episodes)?x.episodes:Array.isArray(x.episode_list)?x.episode_list:[], detailPath:val(x.detail_path,x.detailPath,x.path,'')};
  }

  async function openDetail(slug) {
    navigate('watch'); const root=$('#watch-view, #detail-view, #watch-container'); if(root) loading(root,'Loading title...');
    try { const d=normalizeDetail(await getDetail(slug)); HIV3.detail=d; renderDetail(d); return d; } catch(e){ error(root,e.message); return null; }
  }

  function renderDetail(d) {
    const root=$('#watch-view, #detail-view, #watch-container'); if(!root)return;
    const title=$('#watch-title, .watch-title, .detail-title, h1',root), desc=$('#watch-description, .watch-description, .detail-description',root), poster=$('.watch-poster img, .detail-poster img, #detail-poster',root), back=$('.watch-backdrop img, .detail-backdrop img, #detail-backdrop',root), genres=$('#watch-genres, .watch-genres, .detail-genres',root), eps=$('#episodes-container, .episodes-container, .episode-list',root);
    if(title) title.textContent=d.title; if(desc) desc.textContent=d.description || 'No description available.';
    if(poster && d.poster) { poster.src=d.poster; poster.alt=d.title; } if(back && d.backdrop) { back.src=d.backdrop; back.alt=d.title; }
    if(genres) genres.innerHTML=d.genres.map(g=>`<span class="genre-chip">${esc(g)}</span>`).join('');
    if(eps) renderEpisodes(eps,d.episodes);
    $$('[data-action="play"], .play-button, .primary-action',root).forEach(b=>b.onclick=()=>startPlayback(d));
  }

  function epData(e,i) { if(typeof e==='string'||typeof e==='number') return {number:i+1,ep:e,se:1,title:`Episode ${i+1}`,detail_path:HIV3.detail?.detailPath||''}; return {number:val(e.episode,e.episode_number,e.number,i+1),ep:val(e.ep,e.episode,e.episode_number,i+1),se:val(e.se,e.season,e.season_number,1),title:val(e.name,e.title,`Episode ${i+1}`),detail_path:val(e.detail_path,e.detailPath,HIV3.detail?.detailPath,'')}; }
  function renderEpisodes(c,list) { c.innerHTML=list.map((e,i)=>{const x=epData(e,i);return `<button class="episode-item" data-episode="${esc(x.ep)}" data-season="${esc(x.se)}" data-detail-path="${esc(x.detail_path)}"><span>${esc(x.number)}</span><strong>${esc(x.title)}</strong></button>`}).join(''); $$('.episode-item',c).forEach(b=>b.onclick=()=>startPlayback(HIV3.detail,{ep:b.dataset.episode,se:b.dataset.season,detail_path:b.dataset.detailPath})); }

  async function stream(subjectId, opts={}) { return api(`/api/stream/${encodeURIComponent(subjectId)}`,{detail_path:opts.detail_path||opts.detailPath||'',se:opts.se||'',ep:opts.ep||''}); }
  async function captions(subjectId, opts={}) { return api(`/api/stream/${encodeURIComponent(subjectId)}/captions`,{detail_path:opts.detail_path||opts.detailPath||'',se:opts.se||'',ep:opts.ep||''}); }
  function findURL(x) {
    if(!x)return ''; if(typeof x==='string' && /^https?:\/\//i.test(x))return x;
    if(typeof x!=='object')return '';
    for(const k of ['url','stream_url','play_url','video_url','hls','hls_url','m3u8','dash','dash_url']) if(typeof x[k]==='string' && /^https?:\/\//i.test(x[k]))return x[k];
    for(const k of ['data','stream','result','sources','items','resolutions']) { const y=x[k]; if(Array.isArray(y)){for(const z of y){const u=findURL(z);if(u)return u;}} else if(y&&typeof y==='object'){const u=findURL(y);if(u)return u;} }
    return '';
  }

  async function startPlayback(d=HIV3.detail, opts={}) {
    const id=val(d?.subjectId,d?.subject_id,d?.id); if(!id)return null;
    try {
      const data=await stream(id,opts), src=findURL(data), video=$('#video-player, #player-video, #watch-video, video');
      if(!src || !video) { console.warn('[HIV3] No playable URL or video element.',data); return data; }
      if(window.Hls && src.includes('.m3u8') && window.Hls.isSupported()) { if(video.hlsInstance)video.hlsInstance.destroy(); const h=new Hls(); video.hlsInstance=h; h.loadSource(src); h.attachMedia(video); }
      else video.src=src;
      video.controls=true; video.autoplay=true; video.playsInline=true; try{await video.play();}catch(_){ }
      const caps=await captions(id,opts).catch(()=>null); if(caps) attachCaptions(video,caps);
      return data;
    } catch(e){ console.error('[HIV3] stream error',e); return null; }
  }

  function attachCaptions(video,data) {
    const src=data?.data || data, list=Array.isArray(src)?src:(src?.captions||src?.subtitles||src?.tracks||[]); if(!Array.isArray(list))return;
    video.querySelectorAll('track[data-hiv3-caption]').forEach(t=>t.remove());
    list.forEach(x=>{const u=typeof x==='string'?x:val(x.url,x.src,x.file,x.caption_url,'');if(!u)return;const t=document.createElement('track');t.dataset.hiv3Caption='1';t.kind='subtitles';t.label=typeof x==='string'?'Subtitles':val(x.label,x.name,x.language,'Subtitles');t.srclang=typeof x==='string'?'en':val(x.lang,x.language_code,'en');t.src=u;video.appendChild(t);});
  }

  function bindUI() {
    $$('[data-spa]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.spa;if(a==='home')loadHome();else if(a==='search')navigate('search');else navigate(a);}));
    $$('.category-btn').forEach(b=>b.addEventListener('click',()=>{ $$('.category-btn').forEach(x=>x.classList.toggle('active',x===b)); const a=b.dataset.action; if(a==='home')loadHome(); else if(a==='trending')loadCategory('trending'); else if(['movies','tv-series','animation'].includes(a))loadCategory(a); else if(a==='search')navigate('search'); }));
    $$('[data-genre]').forEach(b=>b.addEventListener('click',()=>search(b.dataset.genre)));
    $$('[data-action="profile"]').forEach(b=>b.addEventListener('click',()=>navigate('profile')));
    $$('[data-action="downloads"]').forEach(b=>b.addEventListener('click',()=>navigate('downloads')));
    const input=$('#search-input, #search-view input[type="search"], #search-view input');
    if(input){input.addEventListener('input',()=>{clearTimeout(HIV3.searchTimer);const q=input.value.trim();if(q.length<2)return;HIV3.searchTimer=setTimeout(()=>suggest(q).then(list=>{const c=$('#search-suggestions');if(c)c.innerHTML=list.slice(0,8).map(x=>`<button class="hiv3-suggestion" data-slug="${esc(x.slug)}">${esc(x.title)}</button>`).join('');$$('.hiv3-suggestion',c||document).forEach(b=>b.onclick=()=>openDetail(b.dataset.slug));}),350);});input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search(input.value);}});}
    document.addEventListener('click',e=>{if(e.target.closest('[data-hiv3-retry]')) HIV3.category==='home'?loadHome():loadCategory(HIV3.category,HIV3.page);});
  }

  window.HIV3API = {
    config:HIV3,
    request:api,
    home:loadHome,
    movies:(page=1,sort='')=>loadCategory('movies',page,sort),
    tvSeries:(page=1,sort='')=>loadCategory('tv-series',page,sort),
    animation:(page=1,sort='')=>loadCategory('animation',page,sort),
    suggest, search, detail:getDetail, stream, captions, openDetails:openDetail, openWatch:openDetail, startPlayback,
    setAPIBase(base){HIV3.base=String(base||'').replace(/\/+$/,'');localStorage.setItem('HIV3_API_BASE_URL',HIV3.base);return HIV3.base;},
    getAPIBase(){return HIV3.base;}
  };

  async function boot(){ bindUI(); bindCards(); const h=location.hash.replace('#',''); if(h && ['home','search','category','downloads','profile','watch'].includes(h)) showView(h); else showView('home'); await loadHome(); }
  window.addEventListener('hashchange',()=>{const h=location.hash.replace('#','')||'home'; if(['movies','tv-series','animation','trending'].includes(h))loadCategory(h);else showView(h);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
