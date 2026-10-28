'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'local-development-secret-change-before-deploying');
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const COVER_DIR = path.join(DATA_DIR, 'covers');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'tracks.json');
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

if (IS_PRODUCTION && !SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

for (const dir of [DATA_DIR, AUDIO_DIR, COVER_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n', 'utf8');

app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tiktokcdn.com', 'https://*.tiktokcdn-us.com', 'https://*.tiktokcdn-eu.com'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null
    }
  }
}));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'nsp.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Попробуй позже.' }
});

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus', '.webm']);
const COVER_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 2, fields: 8, fieldSize: 6000 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = file.fieldname === 'audio' ? AUDIO_EXTS.has(ext) : file.fieldname === 'cover' && COVER_EXTS.has(ext);
    if (!allowed) return cb(new Error(file.fieldname === 'audio'
      ? 'Формат аудио не поддерживается. Используй MP3, WAV, M4A, AAC, OGG, FLAC, OPUS или WEBM.'
      : 'Обложка должна быть в формате JPG, PNG или WEBP.'));
    cb(null, true);
  }
});

function readTracks() {
  try {
    const value = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (err) {
    console.error('Could not read tracks.json:', err.message);
    return [];
  }
}

function writeTracks(tracks) {
  const temporary = `${DB_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(tracks, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, DB_FILE);
}

function safeDelete(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (err) { if (err.code !== 'ENOENT') console.error('File cleanup failed:', err.message); }
}

function clearUploadedFiles(files) {
  if (!files) return;
  for (const group of Object.values(files)) {
    for (const file of group || []) safeDelete(file.path);
  }
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return sendError(res, 503, 'Владелец ещё не настроил пароль загрузки на сервере.');
  if (req.session.isAdmin !== true) return sendError(res, 401, 'Сначала войди в режим автора.');
  next();
}

function sameSecret(candidate, expected) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function identifyFile(filePath, type) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytes = Buffer.alloc(16);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const b = bytes.subarray(0, count);
    if (type === 'audio') {
      return (
        (b.length >= 3 && b.toString('ascii', 0, 3) === 'ID3') ||
        (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ||
        (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') ||
        (b.length >= 8 && b.toString('ascii', 4, 8) === 'ftyp') ||
        (b.length >= 4 && b.toString('ascii', 0, 4) === 'OggS') ||
        (b.length >= 4 && b.toString('ascii', 0, 4) === 'fLaC') ||
        (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
      );
    }
    return (
      (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
      (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) ||
      (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')
    );
  } finally {
    fs.closeSync(fd);
  }
}

function toPublicTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    genre: track.genre,
    description: track.description,
    createdAt: track.createdAt,
    audioUrl: `/media/audio/${encodeURIComponent(track.audioFilename)}`,
    coverUrl: track.coverFilename ? `/media/covers/${encodeURIComponent(track.coverFilename)}` : null
  };
}

app.get('/api/config', (req, res) => {
  res.json({ uploadEnabled: Boolean(ADMIN_PASSWORD), isAdmin: req.session.isAdmin === true, maxAudioSizeMB: 100, aiGenerationEnabled: Boolean(process.env.AI_API_KEY && process.env.AI_API_URL && process.env.AI_MODEL) });
});

const nspGenerateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Слишком много генераций подряд. Попробуй позже.' } });

app.use('/api/nsp', (req, res, next) => {
  const origin = req.get('origin');
  const allowed = new Set([process.env.SITE_ORIGIN || 'https://neyro-hcp.github.io', ...(IS_PRODUCTION ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000'])]);
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/api/nsp/generate', nspGenerateLimiter, async (req, res) => {
  const { AI_API_KEY: apiKey, AI_API_URL: apiUrl, AI_MODEL: model } = process.env;
  if (!apiKey || !apiUrl || !model) return sendError(res, 503, 'ИИ пока не настроен на сервере. Нужны AI_API_KEY, AI_API_URL и AI_MODEL.');
  const b = req.body || {};
  const topic = typeof b.topic === 'string' ? b.topic.trim().slice(0, 1200) : '';
  if (!topic) return sendError(res, 400, 'Укажи тему или ситуацию для текста.');
  const take = (v, n, fallback = '') => typeof v === 'string' ? v.trim().slice(0, n) : fallback;
  const format = take(b.format, 100, 'Куплет на 16 строк');
  const mood = take(b.mood, 100, 'Смешанное');
  const flow = take(b.flow, 120, 'Разговорная подача');
  const words = take(b.requiredWords, 500);
  const examples = take(b.examples, 8000);
  const rhyme = Number.isFinite(Number(b.rhymeDensity)) ? Math.max(20, Math.min(100, Number(b.rhymeDensity))) : 75;
  const internal = Number.isFinite(Number(b.internalRhymes)) ? Math.max(0, Math.min(100, Number(b.internalRhymes))) : 80;
  const systemPrompt = [
    'Ты помогаешь автору НсП создавать новые русскоязычные рэп-тексты и фристайлы.',
    'Строй стиль по настройкам и примерам, которые дал сам пользователь: разговорная подача, неожиданные точные рифмы, внутренние рифмы, естественный флоу, конкретные детали и авторская интонация.',
    'Не копируй и не продолжай существующие песни, чужие куплеты или узнаваемые строки. Не выдумывай биографические факты об авторе.',
    'Избегай пустых рифм ради рифм, шаблонного пафоса, одинаковых окончаний в каждой строке и пояснений вокруг текста.',
    'Примеры пользователя — ориентир по его собственной манере; не повторяй целые строки из них без необходимости.',
    'Верни только готовый текст с заголовками частей при необходимости, без анализа, вступления и заключения.'
  ].join('\n');
  const userPrompt = ['ТЕМА / СИТУАЦИЯ: ' + topic, 'ФОРМАТ: ' + format, 'НАСТРОЕНИЕ: ' + mood, 'ПОДАЧА / ФЛОУ: ' + flow, 'ПЛОТНОСТЬ РИФМ: ' + rhyme + '%', 'ВНУТРЕННИЕ РИФМЫ: ' + internal + '%', 'ОБЯЗАТЕЛЬНЫЕ СЛОВА И ДЕТАЛИ: ' + (words || 'не заданы'), 'СОБСТВЕННЫЕ ПРИМЕРЫ АВТОРА:\n' + (examples || 'не предоставлены'), 'Напиши оригинальный текст, который можно произнести вслух в устойчивом ритме. Не объясняй процесс написания.'].join('\n\n');
  try {
    const response = await fetch(apiUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.9, max_tokens: 1800 }), signal: AbortSignal.timeout(45000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      console.error('AI generation provider returned HTTP', response.status);
      return sendError(res, response.status === 429 ? 429 : 502, response.status === 429 ? 'У модели временный лимит запросов. Попробуй позже.' : 'Сервис ИИ отклонил запрос. Проверь настройки модели на сервере.');
    }
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof text !== 'string' || !text.trim()) return sendError(res, 502, 'Модель не вернула текст. Попробуй ещё раз.');
    res.set('Cache-Control', 'no-store');
    return res.json({ text: text.trim().slice(0, 12000), model });
  } catch (err) {
    if (err && err.name === 'TimeoutError') return sendError(res, 504, 'Модель отвечает слишком долго. Попробуй ещё раз.');
    console.error('AI generation request failed:', err.message);
    return sendError(res, 502, 'Не удалось связаться с сервисом ИИ. Проверь настройки backend.');
  }
});

app.get('/api/tracks', (_req, res) => {
  const tracks = readTracks()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(toPublicTrack);
  res.set('Cache-Control', 'no-store');
  res.json({ tracks });
});

app.post('/api/login', loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) return sendError(res, 503, 'Пароль автора не настроен. Скопируй .env.example в .env и задай ADMIN_PASSWORD.');
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !sameSecret(password, ADMIN_PASSWORD)) {
    return sendError(res, 401, 'Пароль не подошёл.');
  }
  req.session.regenerate((err) => {
    if (err) return sendError(res, 500, 'Не удалось создать сессию.');
    req.session.isAdmin = true;
    req.session.save((saveErr) => {
      if (saveErr) return sendError(res, 500, 'Не удалось сохранить сессию.');
      res.json({ ok: true });
    });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return sendError(res, 500, 'Не удалось завершить сессию.');
    res.clearCookie('nsp.sid', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
    res.json({ ok: true });
  });
});

app.post('/api/tracks', requireAdmin, (req, res, next) => {
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      clearUploadedFiles(req.files);
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой. Максимальный размер аудио — 100 МБ.' : 'Не удалось принять файлы. Проверь их количество и размер.';
        return sendError(res, 400, msg);
      }
      return sendError(res, 400, err.message || 'Не удалось принять файлы.');
    }
    next();
  });
}, (req, res) => {
  const files = req.files || {};
  const audio = files.audio && files.audio[0];
  const cover = files.cover && files.cover[0];
  const reject = (status, message) => {
    clearUploadedFiles(files);
    return sendError(res, status, message);
  };

  if (!audio) return reject(400, 'Добавь аудиофайл.');
  if (audio.size > MAX_AUDIO_BYTES) return reject(400, 'Аудиофайл больше 100 МБ.');
  if (cover && cover.size > MAX_COVER_BYTES) return reject(400, 'Обложка должна быть не больше 8 МБ.');
  if (!identifyFile(audio.path, 'audio')) return reject(400, 'Похоже, этот файл не является поддерживаемым аудио.');
  if (cover && !identifyFile(cover.path, 'cover')) return reject(400, 'Не удалось распознать изображение обложки.');

  const title = String(req.body.title || '').trim().slice(0, 100);
  const artist = String(req.body.artist || '').trim().slice(0, 80);
  const genre = String(req.body.genre || 'Другое').trim().slice(0, 40) || 'Другое';
  const description = String(req.body.description || '').trim().slice(0, 1000);
  if (!title) return reject(400, 'Укажи название трека.');

  const id = crypto.randomUUID();
  const audioFilename = `${id}${path.extname(audio.originalname).toLowerCase()}`;
  const coverFilename = cover ? `${id}${path.extname(cover.originalname).toLowerCase()}` : null;
  try {
    fs.renameSync(audio.path, path.join(AUDIO_DIR, audioFilename));
    if (cover) fs.renameSync(cover.path, path.join(COVER_DIR, coverFilename));
    const track = { id, title, artist, genre, description, createdAt: new Date().toISOString(), audioFilename, coverFilename };
    const tracks = readTracks();
    tracks.push(track);
    writeTracks(tracks);
    res.status(201).json({ track: toPublicTrack(track) });
  } catch (err) {
    safeDelete(path.join(AUDIO_DIR, audioFilename));
    safeDelete(path.join(COVER_DIR, coverFilename));
    safeDelete(audio.path);
    if (cover) safeDelete(cover.path);
    console.error('Could not save uploaded track:', err.message);
    sendError(res, 500, 'Не удалось сохранить трек на сервере.');
  }
});

app.delete('/api/tracks/:id', requireAdmin, (req, res) => {
  const tracks = readTracks();
  const index = tracks.findIndex((track) => track.id === req.params.id);
  if (index === -1) return sendError(res, 404, 'Трек не найден.');
  const [track] = tracks.splice(index, 1);
  try {
    writeTracks(tracks);
    safeDelete(path.join(AUDIO_DIR, path.basename(track.audioFilename || '')));
    safeDelete(path.join(COVER_DIR, path.basename(track.coverFilename || '')));
    res.json({ ok: true });
  } catch (err) {
    console.error('Could not delete track:', err.message);
    sendError(res, 500, 'Не удалось удалить трек.');
  }
});

app.use('/media/audio', express.static(AUDIO_DIR, {
  dotfiles: 'deny', index: false, maxAge: '1h',
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); }
}));
app.use('/media/covers', express.static(COVER_DIR, {
  dotfiles: 'deny', index: false, maxAge: '1d',
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); }
}));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use((err, _req, res, _next) => {
  console.error(err.stack || err.message || err);
  if (res.headersSent) return;
  sendError(res, 500, 'На сервере произошла ошибка.');
});

app.listen(PORT, () => {
  console.log(`Музыкальный сайт запущен: http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD не задан: режим автора отключён до настройки .env.');
});
