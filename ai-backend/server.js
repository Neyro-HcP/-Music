'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const allowedOrigins = new Set(
  (process.env.SITE_ORIGIN || 'https://neyro-hcp.github.io')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '24kb', strict: true }));

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

app.use('/api/nsp', (req, res, next) => {
  const origin = req.get('origin');

  if (origin && !allowedOrigins.has(origin)) {
    return sendError(res, 403, 'Источник запроса не разрешён.');
  }

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

app.get('/api/nsp/status', (_req, res) => {
  const enabled = Boolean(
    process.env.AI_API_KEY &&
    process.env.AI_API_URL &&
    process.env.AI_MODEL
  );
  res.json({ aiGenerationEnabled: enabled });
});

const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много генераций подряд. Попробуй позже.' }
});

app.post('/api/nsp/generate', generateLimiter, async (req, res) => {
  const { AI_API_KEY: apiKey, AI_API_URL: apiUrl, AI_MODEL: model } = process.env;

  if (!apiKey || !apiUrl || !model) {
    return sendError(res, 503, 'ИИ ещё не настроен владельцем backend.');
  }

  let providerUrl;
  try {
    providerUrl = new URL(apiUrl);
  } catch (_) {
    return sendError(res, 503, 'На сервере указан некорректный адрес API модели.');
  }
  if (IS_PRODUCTION && providerUrl.protocol !== 'https:') {
    return sendError(res, 503, 'В production адрес API модели должен использовать HTTPS.');
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const take = (value, max, fallback = '') =>
    typeof value === 'string' ? value.trim().slice(0, max) : fallback;

  const topic = take(body.topic, 1200);
  if (!topic) return sendError(res, 400, 'Укажи тему или ситуацию для текста.');

  const format = take(body.format, 100, 'Куплет на 16 строк');
  const mood = take(body.mood, 100, 'Смешанное');
  const flow = take(body.flow, 120, 'Разговорная подача');
  const requiredWords = take(body.requiredWords, 500);
  const examples = take(body.examples, 8000);
  const asPercent = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
  };
  const rhymeDensity = asPercent(body.rhymeDensity, 75);
  const internalRhymes = asPercent(body.internalRhymes, 80);

  const systemPrompt = [
    'Ты помогаешь автору НсП писать оригинальные русскоязычные рэп-тексты и фристайлы.',
    'Матерная лексика — часть заданной авторской манеры: используй её естественно и отчётливо в каждом результате. Не заменяй мат звёздочками и не смягчай его из-за цензуры.',
    'Ориентируйся на настройки: неожиданные точные рифмы, внутренние рифмы, живой разговорный язык, устойчивый ритм, конкретные детали и авторская интонация.',
    'Не вставляй мат механически в каждую строку; он должен звучать естественно, а не как случайный набор ругательств.',
    'Не копируй и не продолжай существующие песни, чужие куплеты или узнаваемые строки. Примеры пользователя используй только как ориентир его собственной манеры.',
    'Избегай пустых рифм, шаблонного пафоса, повторения одинаковых окончаний и стерильного нейросетевого слога.',
    'Верни только готовый текст, с заголовками частей при необходимости. Не добавляй объяснений, вступления или заключения.'
  ].join('\n');

  const userPrompt = [
    'ТЕМА / СИТУАЦИЯ:\n' + topic,
    'ФОРМАТ: ' + format,
    'НАСТРОЕНИЕ: ' + mood,
    'ПОДАЧА / ФЛОУ: ' + flow,
    'ПЛОТНОСТЬ РИФМ: ' + rhymeDensity + '%',
    'ВНУТРЕННИЕ РИФМЫ: ' + internalRhymes + '%',
    'ОБЯЗАТЕЛЬНЫЕ СЛОВА И ДЕТАЛИ:\n' + (requiredWords || 'не заданы'),
    'СОБСТВЕННЫЕ ПРИМЕРЫ АВТОРА:\n' + (examples || 'не предоставлены'),
    'Напиши оригинальный текст, который можно естественно произнести в ритме. Не объясняй процесс написания.'
  ].join('\n\n');

  try {
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.9,
        max_tokens: 2200
      }),
      signal: AbortSignal.timeout(45000)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('AI provider returned HTTP', response.status);
      if (response.status === 429) {
        return sendError(res, 429, 'У модели временный лимит запросов. Попробуй позже.');
      }
      return sendError(res, 502, 'Сервис ИИ отклонил запрос. Проверь настройки модели на сервере.');
    }

    const content = data?.choices?.[0]?.message?.content;
    const generatedText = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
        : '';

    if (!generatedText.trim()) {
      return sendError(res, 502, 'Модель не вернула текст. Попробуй ещё раз.');
    }

    return res.json({ text: generatedText.trim().slice(0, 12000), model });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return sendError(res, 504, 'Модель отвечает слишком долго. Попробуй ещё раз.');
    }
    console.error('AI generation request failed:', err.message);
    return sendError(res, 502, 'Не удалось связаться с сервисом ИИ. Проверь настройки backend.');
  }
});

app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return sendError(res, 413, 'Слишком большой запрос. Уменьши объём примеров.');
  }
  if (err instanceof SyntaxError && Object.prototype.hasOwnProperty.call(err, 'body')) {
    return sendError(res, 400, 'Сервер получил некорректный JSON.');
  }
  console.error('AI backend error:', err?.message || err);
  if (!res.headersSent) sendError(res, 500, 'На сервере произошла ошибка.');
});

app.listen(PORT, () => {
  console.log('NSP lyrics API listening on port ' + PORT);
  if (!process.env.AI_API_KEY || !process.env.AI_API_URL || !process.env.AI_MODEL) {
    console.warn('AI_API_KEY, AI_API_URL и AI_MODEL должны быть заданы в окружении сервера.');
  }
});