'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  tracks: [],
  view: 'all',
  filter: 'all',
  query: '',
  sort: 'newest',
  isAdmin: false,
  uploadEnabled: false,
  currentTrackId: null,
  favorites: new Set(),
  toastTimer: null
};

const audio = $('#audio');
const modal = $('#modalBackdrop');
const loginForm = $('#loginForm');
const uploadForm = $('#uploadForm');
const aboutContent = $('#aboutContent');

try {
  const saved = JSON.parse(localStorage.getItem('nsp-favorites') || '[]');
  if (Array.isArray(saved)) state.favorites = new Set(saved.filter((id) => typeof id === 'string'));
} catch { state.favorites = new Set(); }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || `Ошибка запроса (${response.status})`);
  return data;
}

function toast(message, type = 'success') {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', type === 'error');
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

function openModal(mode) {
  loginForm.hidden = mode !== 'login';
  uploadForm.hidden = mode !== 'upload';
  aboutContent.hidden = mode !== 'about';
  $('#modalIntro').hidden = mode === 'about';
  $('#loginError').textContent = '';
  $('#uploadError').textContent = '';

  if (mode === 'login') {
    $('#modalKicker').textContent = 'РЕЖИМ АВТОРА';
    $('#modalTitle').innerHTML = 'ТВОЯ МУЗЫКА.<br><span>ТВОЙ КАТАЛОГ.</span>';
    $('#modalIntro').textContent = 'Войди, чтобы загружать и управлять своими публикациями.';
  } else if (mode === 'upload') {
    $('#modalKicker').textContent = 'НОВЫЙ РЕЛИЗ';
    $('#modalTitle').innerHTML = 'ДОБАВЬ СВОЙ<br><span>ЗВУК.</span>';
    $('#modalIntro').textContent = 'Заполни данные, выбери аудио и опубликуй трек в своей библиотеке.';
  } else {
    $('#modalKicker').textContent = 'О ПРОЕКТЕ';
    $('#modalTitle').innerHTML = 'НсП MUSIC<span>.</span><br><span>СВОЯ ВОЛНА.</span>';
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  if (mode === 'login') $('#adminPassword').focus();
  if (mode === 'upload') $('#trackTitle').focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
}

function requestUpload() {
  if (!state.uploadEnabled) {
    toast('На сервере ещё не задан ADMIN_PASSWORD.', 'error');
    openModal('about');
    return;
  }
  openModal(state.isAdmin ? 'upload' : 'login');
}

function updateAuthorButton() {
  $('#authorButtonText').textContent = state.isAdmin ? 'Выйти из студии' : 'Войти как автор';
  $('#authorButton').classList.toggle('is-admin', state.isAdmin);
}

function storeFavorites() {
  try { localStorage.setItem('nsp-favorites', JSON.stringify([...state.favorites])); } catch {}
  renderTracks();
  updatePlayerFavorite();
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Новый релиз';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date).replace('.', '');
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < String(value).length; i++) hash = ((hash << 5) - hash + String(value).charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function coverMarkup(track, index, extra = '') {
  if (track.coverUrl) {
    return `<img class="track-cover ${extra}" src="${escapeHtml(track.coverUrl)}" alt="Обложка: ${escapeHtml(track.title)}" loading="lazy">`;
  }
  const variant = hashString(track.id || track.title) % 4;
  return `<div class="track-cover generated-cover cover-variant-${variant} ${extra}" role="img" aria-label="Обложка: ${escapeHtml(track.title)}"><span class="cover-wordmark">НсП</span><span class="cover-index">Nº ${String(index + 1).padStart(2, '0')} / ORIGINAL</span></div>`;
}

function filteredTracks() {
  let list = [...state.tracks];
  const mode = state.view !== 'all' ? state.view : state.filter;
  if (mode === 'favorites') list = list.filter((track) => state.favorites.has(track.id));
  if (mode === 'recent') list = list.slice(0, 8);
  if (state.query) {
    const needle = state.query.toLocaleLowerCase('ru-RU');
    list = list.filter((track) => [track.title, track.artist, track.genre, track.description]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(needle)));
  }
  if (state.sort === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  else if (state.sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  else if (state.sort === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist, 'ru'));
  else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

function setView(view) {
  state.view = view;
  state.filter = view;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.filter-pill').forEach((button) => button.classList.toggle('active', button.dataset.filter === view));
  const titles = {
    all: ['Моя библиотека.', 'Все твои релизы — в одном месте.'],
    recent: ['Недавние релизы.', 'Последние добавленные треки.'],
    favorites: ['Избранное.', 'Треки, к которым хочется возвращаться.']
  };
  $('#viewTitle').textContent = titles[view][0];
  $('#viewDescription').textContent = titles[view][1];
  renderTracks();
}

function updateCounts() {
  const count = state.tracks.length;
  const favorites = state.tracks.filter((track) => state.favorites.has(track.id)).length;
  $('#trackStat').textContent = String(count).padStart(2, '0');
  $('#sidebarCount').textContent = count;
  $('#allCount').textContent = count;
  $('#favoriteCount').textContent = favorites;
}

function renderSidebarLibrary() {
  const root = $('#sidebarLibrary');
  const recent = [...state.tracks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
  if (!recent.length) {
    root.innerHTML = '<div class="sidebar-empty"><span class="sidebar-empty-icon">♫</span><span>Здесь появятся<br>твои треки</span></div>';
    return;
  }
  root.innerHTML = recent.map((track, index) => `
    <button class="sidebar-track" type="button" data-sidebar-play="${escapeHtml(track.id)}">
      ${coverMarkup(track, index, 'sidebar-track-cover')}
      <span><b>${escapeHtml(track.title)}</b><small>${escapeHtml(track.artist)}</small></span>
      <i>▶</i>
    </button>`).join('');
}

function renderTracks() {
  const list = filteredTracks();
  const grid = $('#trackGrid');
  grid.innerHTML = list.map((track, index) => `
    <article class="track-card" data-track-card="${escapeHtml(track.id)}">
      <div class="track-cover-wrap">
        ${coverMarkup(track, index)}
        <div class="track-play-overlay"><button type="button" data-action="play" data-id="${escapeHtml(track.id)}" aria-label="Воспроизвести ${escapeHtml(track.title)}">${state.currentTrackId === track.id && !audio.paused ? 'Ⅱ' : '▶'}</button></div>
        <span class="cover-number">${String(index + 1).padStart(2, '0')}</span>
      </div>
      <div class="track-card-top"><div class="track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div><button class="favorite-button ${state.favorites.has(track.id) ? 'saved' : ''}" type="button" data-action="favorite" data-id="${escapeHtml(track.id)}" aria-label="В избранное">${state.favorites.has(track.id) ? '♥' : '♡'}</button></div>
      <div class="track-artist">${escapeHtml(track.artist || 'НсП')}</div>
      <div class="track-card-meta"><span class="genre-tag">${escapeHtml(track.genre || 'Другое')}</span><span class="track-date">${escapeHtml(formatDate(track.createdAt))}</span></div>
      ${track.description ? `<p class="track-description">${escapeHtml(track.description)}</p>` : ''}
      ${state.isAdmin ? `<button class="delete-track" type="button" data-action="delete" data-id="${escapeHtml(track.id)}">Удалить трек ×</button>` : ''}
    </article>`).join('');

  const empty = list.length === 0;
  $('#emptyState').hidden = !empty;
  grid.hidden = empty;
  if (empty) {
    const mode = state.view !== 'all' ? state.view : state.filter;
    if (state.query) {
      $('#emptyTitle').textContent = 'НИЧЕГО НЕ НАШЛОСЬ';
      $('#emptyText').textContent = 'Попробуй изменить запрос или очистить поиск.';
      $('#emptyUpload').hidden = true;
    } else if (mode === 'favorites') {
      $('#emptyTitle').textContent = 'ПОКА НИЧЕГО НЕ СОХРАНЕНО';
      $('#emptyText').textContent = 'Отмечай сердечком любимые релизы — они соберутся здесь.';
      $('#emptyUpload').hidden = true;
    } else if (mode === 'recent') {
      $('#emptyTitle').textContent = 'ПОКА НЕТ НОВЫХ РЕЛИЗОВ';
      $('#emptyText').textContent = 'Загрузи первый трек, чтобы он появился здесь.';
      $('#emptyUpload').hidden = false;
    } else {
      $('#emptyTitle').textContent = 'ЗДЕСЬ БУДЕТ ТВОЙ ЗВУК';
      $('#emptyText').textContent = 'Библиотека пока пустая. Загрузи первый трек — и начнём собирать твою музыкальную историю.';
      $('#emptyUpload').hidden = false;
    }
  }
  updateCounts();
  renderSidebarLibrary();
  updatePlayerFavorite();
}

function findTrack(id) {
  return state.tracks.find((track) => track.id === id);
}

async function startTrack(id) {
  const track = findTrack(id);
  if (!track) return;
  state.currentTrackId = id;
  audio.src = track.audioUrl;
  $('#playerTitle').textContent = track.title;
  $('#playerArtist').textContent = track.artist || 'НсП';
  $('#playerCover').innerHTML = track.coverUrl
    ? `<img src="${escapeHtml(track.coverUrl)}" alt="">`
    : '<span>НсП</span>';
  $('#playerCover').classList.toggle('cover-placeholder', !track.coverUrl);
  updatePlayerFavorite();
  renderTracks();
  try { await audio.play(); }
  catch { toast('Не удалось воспроизвести этот файл в браузере.', 'error'); }
}

function playRelative(direction) {
  const list = filteredTracks().length ? filteredTracks() : state.tracks;
  if (!list.length) return;
  const index = list.findIndex((track) => track.id === state.currentTrackId);
  const next = index < 0 ? 0 : (index + direction + list.length) % list.length;
  startTrack(list[next].id);
}

function updatePlayerState() {
  const playing = !audio.paused;
  $('#playGlyph').textContent = playing ? 'Ⅱ' : '▶';
  $('#playButton').setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
  $('#playButton').disabled = !state.currentTrackId && state.tracks.length === 0;
  $('#prevButton').disabled = state.tracks.length < 2;
  $('#nextButton').disabled = state.tracks.length < 2;
  $('#seekBar').disabled = !state.currentTrackId || !Number.isFinite(audio.duration);
  $('#playerFavorite').disabled = !state.currentTrackId;
  renderTracks();
}

function updatePlayerFavorite() {
  const saved = state.currentTrackId && state.favorites.has(state.currentTrackId);
  $('#playerFavorite').textContent = saved ? '♥' : '♡';
  $('#playerFavorite').classList.toggle('saved', Boolean(saved));
  $('#playerFavorite').setAttribute('aria-label', saved ? 'Убрать из избранного' : 'Добавить в избранное');
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  storeFavorites();
}

async function deleteTrack(id) {
  const track = findTrack(id);
  if (!track || !window.confirm(`Удалить «${track.title}» из библиотеки? Файл будет удалён с сервера.`)) return;
  try {
    await api(`/api/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.currentTrackId === id) {
      audio.pause(); audio.removeAttribute('src'); audio.load(); state.currentTrackId = null;
      $('#playerTitle').textContent = 'Выбери свой трек';
      $('#playerArtist').textContent = 'Твоя музыка начнётся здесь';
      $('#playerCover').innerHTML = '<span>НсП</span>';
      $('#playerCover').classList.add('cover-placeholder');
      $('#seekBar').value = '0';
    }
    state.favorites.delete(id);
    state.tracks = state.tracks.filter((item) => item.id !== id);
    storeFavorites();
    updatePlayerState();
    toast('Трек удалён из библиотеки.');
  } catch (error) { toast(error.message, 'error'); }
}

async function refreshLibrary(showMessage = false) {
  try {
    const result = await api('/api/tracks', { cache: 'no-store' });
    state.tracks = Array.isArray(result.tracks) ? result.tracks : [];
    renderTracks();
    updatePlayerState();
    if (showMessage) toast('Библиотека обновлена.');
  } catch (error) { toast(`Не удалось загрузить библиотеку: ${error.message}`, 'error'); }
}

async function initialise() {
  try {
    const config = await api('/api/config');
    state.uploadEnabled = Boolean(config.uploadEnabled);
    state.isAdmin = Boolean(config.isAdmin);
    updateAuthorButton();
  } catch { toast('Не удалось подключиться к серверу.', 'error'); }
  await refreshLibrary();
  audio.volume = Number($('#volumeBar').value);
}

$('#heroUpload').addEventListener('click', requestUpload);
$('#heroUploadSecondary').addEventListener('click', requestUpload);
$('#emptyUpload').addEventListener('click', requestUpload);
$('#sidebarUpload').addEventListener('click', requestUpload);
$('#authorButton').addEventListener('click', async () => {
  if (!state.isAdmin) return requestUpload();
  try {
    await api('/api/logout', { method: 'POST' });
    state.isAdmin = false;
    updateAuthorButton();
    renderTracks();
    toast('Ты вышел из режима автора.');
  } catch (error) { toast(error.message, 'error'); }
});
$('#aboutBtn').addEventListener('click', () => openModal('about'));
$('#aboutClose').addEventListener('click', closeModal);
$('#modalClose').addEventListener('click', closeModal);
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); $('#searchInput').focus();
  }
});
$('#exploreButton').addEventListener('click', () => $('#library').scrollIntoView({ behavior: 'smooth' }));
$('#queueButton').addEventListener('click', () => $('#library').scrollIntoView({ behavior: 'smooth' }));
$('#refreshButton').addEventListener('click', () => refreshLibrary(true));
$('#searchInput').addEventListener('input', (event) => { state.query = event.target.value.trim(); renderTracks(); });
$('#sortSelect').addEventListener('change', (event) => { state.sort = event.target.value; renderTracks(); });
$$('.filter-pill').forEach((button) => button.addEventListener('click', () => setView(button.dataset.filter)));
$$('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

$('#trackGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { id, action } = button.dataset;
  if (action === 'play') startTrack(id);
  if (action === 'favorite') toggleFavorite(id);
  if (action === 'delete') deleteTrack(id);
});
$('#sidebarLibrary').addEventListener('click', (event) => {
  const button = event.target.closest('[data-sidebar-play]');
  if (button) startTrack(button.dataset.sidebarPlay);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('button[type="submit"]', loginForm);
  const original = button.innerHTML;
  button.disabled = true; button.textContent = 'Входим…'; $('#loginError').textContent = '';
  try {
    await api('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#adminPassword').value })
    });
    state.isAdmin = true;
    updateAuthorButton();
    closeModal();
    loginForm.reset();
    renderTracks();
    toast('Режим автора включён.');
    openModal('upload');
  } catch (error) { $('#loginError').textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = original; }
});

$('#audioFile').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  $('#audioFileName').textContent = file ? file.name : 'Выбери аудиофайл';
  $('#uploadError').textContent = file && file.size > 100 * 1024 * 1024 ? 'Файл больше 100 МБ.' : '';
});
$('#coverFile').addEventListener('change', (event) => {
  const file = event.target.files && event.target.files[0];
  $('#coverFileName').textContent = file ? file.name : 'Добавить обложку';
  $('#uploadError').textContent = file && file.size > 8 * 1024 * 1024 ? 'Обложка больше 8 МБ.' : '';
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#submitUpload');
  const oldText = button.innerHTML;
  $('#uploadError').textContent = '';
  const audioFile = $('#audioFile').files[0];
  const coverFile = $('#coverFile').files[0];
  if (!audioFile) { $('#uploadError').textContent = 'Выбери аудиофайл.'; return; }
  if (audioFile.size > 100 * 1024 * 1024) { $('#uploadError').textContent = 'Аудио должно быть не больше 100 МБ.'; return; }
  if (coverFile && coverFile.size > 8 * 1024 * 1024) { $('#uploadError').textContent = 'Обложка должна быть не больше 8 МБ.'; return; }
  button.disabled = true; button.textContent = 'Загружаем файл…';
  try {
    const result = await api('/api/tracks', { method: 'POST', body: new FormData(uploadForm) });
    state.tracks.push(result.track);
    state.query = ''; $('#searchInput').value = '';
    uploadForm.reset();
    $('#audioFileName').textContent = 'Выбери аудиофайл';
    $('#coverFileName').textContent = 'Добавить обложку';
    closeModal();
    setView('all');
    toast('Трек опубликован. Он уже в твоей библиотеке.');
    $('#library').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { $('#uploadError').textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = oldText; }
});

$('#playButton').addEventListener('click', async () => {
  if (!state.currentTrackId) {
    if (state.tracks[0]) startTrack(state.tracks[0].id);
    return;
  }
  if (audio.paused) {
    try { await audio.play(); } catch { toast('Не удалось начать воспроизведение.', 'error'); }
  } else audio.pause();
});
$('#prevButton').addEventListener('click', () => playRelative(-1));
$('#nextButton').addEventListener('click', () => playRelative(1));
$('#playerFavorite').addEventListener('click', () => { if (state.currentTrackId) toggleFavorite(state.currentTrackId); });
$('#volumeBar').addEventListener('input', (event) => { audio.volume = Number(event.target.value); });
$('#seekBar').addEventListener('input', (event) => {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
    event.target.style.setProperty('--progress', `${Number(event.target.value) / 10}%`);
  }
});
audio.addEventListener('loadedmetadata', () => {
  $('#duration').textContent = formatTime(audio.duration);
  $('#seekBar').disabled = false;
  updatePlayerState();
});
audio.addEventListener('timeupdate', () => {
  $('#currentTime').textContent = formatTime(audio.currentTime);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    const value = Math.round((audio.currentTime / audio.duration) * 1000);
    $('#seekBar').value = String(value);
    $('#seekBar').style.setProperty('--progress', `${value / 10}%`);
  }
});
audio.addEventListener('play', updatePlayerState);
audio.addEventListener('pause', updatePlayerState);
audio.addEventListener('ended', () => {
  if (state.tracks.length > 1) playRelative(1);
  else updatePlayerState();
});
audio.addEventListener('error', () => {
  if (state.currentTrackId) toast('Этот формат не поддерживается браузером или файл недоступен.', 'error');
});

initialise();
