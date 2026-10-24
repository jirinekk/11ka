const crypto = require('crypto');
const articlesService = require('./articles');

const MAX_CHUNKS = 16;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 48;

const GEMINI_CZECH_VOICE = 'cs-cz-advisor-1';
const GEMINI_STYLE = 'klidný český sportovní zpravodaj, přirozená česká výslovnost, čte článek bez extra slov';
const ELEVEN_VOICE = 'pNInz6obpgDQGcFmaJgB';
const ELEVEN_MODEL = 'eleven_multilingual_v2';

const CZECH_NUM = [
  'nula',
  'jedna',
  'dva',
  'tři',
  'čtyři',
  'pět',
  'šest',
  'sedm',
  'osm',
  'devět',
  'deset',
  'jedenáct',
  'dvanáct',
  'třináct',
  'čtrnáct',
  'patnáct',
  'šestnáct',
  'sedmnáct',
  'osmnáct',
  'devatenáct',
  'dvacet',
];

const CZECH_KU = [
  'nule',
  'jedné',
  'dvěma',
  'třem',
  'čtyřem',
  'pěti',
  'šesti',
  'sedmi',
  'osmi',
  'devíti',
  'deseti',
  'jedenácti',
  'dvanácti',
  'třinácti',
  'čtrnácti',
  'patnácti',
];

const cache = new Map();

function elevenKey() {
  return String(process.env.ELEVENLABS_API_KEY || '').trim();
}

function geminiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function geminiVoice() {
  return String(process.env.GEMINI_TTS_VOICE || GEMINI_CZECH_VOICE).trim() || GEMINI_CZECH_VOICE;
}

function elevenVoiceId() {
  return String(process.env.ELEVENLABS_VOICE_ID || ELEVEN_VOICE).trim() || ELEVEN_VOICE;
}

function elevenModel() {
  return String(process.env.ELEVENLABS_MODEL || ELEVEN_MODEL).trim() || ELEVEN_MODEL;
}

function chunkLimit() {
  if (elevenKey()) return 3200;
  return 1200;
}

function isConfigured() {
  return Boolean(elevenKey() || geminiKey());
}

function ttsModels() {
  const preferred = String(process.env.GEMINI_TTS_MODEL || '').trim();
  const list = [
    preferred,
    'gemini-3.8-flash-tts',
    'gemini-3.8-flash-lite-tts',
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
  ].filter(Boolean);
  return [...new Set(list)];
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToSpeechText(html) {
  let text = String(html || '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  text = text.replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ');
  text = text.replace(/<(figure|figcaption|aside)[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<(h[1-6]|p|li|br|div|tr|blockquote)[^>]*>/gi, '\n');
  text = text.replace(/<\/(h[1-6]|p|li|div|tr|blockquote)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/\u00a0/g, ' ');
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

function czechNumber(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 0 || num >= CZECH_NUM.length) return String(n);
  return CZECH_NUM[num];
}

function czechKu(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 0 || num >= CZECH_KU.length) return czechNumber(n);
  return CZECH_KU[num];
}

function normalizeCzechSpeech(input) {
  let text = String(input || '');
  text = text.replace(/\b11ka\b/gi, 'jedenáctka');
  text = text.replace(/\b(\d{1,2})[:–-](\d{1,2})\b/g, (full, home, away) => {
    const a = Number(home);
    const b = Number(away);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a > 15 || b > 15) return full;
    return `${czechNumber(a)} ku ${czechKu(b)}`;
  });
  text = text.replace(/\b(\d{1,3})\s*%/g, (_, n) => `${n} procent`);
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function buildSpeakableText(article) {
  const parts = [];
  if (article && article.title) parts.push(String(article.title).trim());
  if (article && article.excerpt) parts.push(String(article.excerpt).trim());
  const body = htmlToSpeechText(article && article.body_html);
  if (body) parts.push(body);
  const joined = parts.filter(Boolean).join('. ');
  return normalizeCzechSpeech(joined.replace(/\s+/g, ' ').trim());
}

function splitOversized(piece, max) {
  if (piece.length <= max) return [piece];
  const out = [];
  let rest = piece;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function chunkText(text, max = chunkLimit()) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const chunks = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > max && current) {
      chunks.push(...splitOversized(current, max));
      current = sentence;
    } else {
      current = next;
    }
  });
  if (current) chunks.push(...splitOversized(current, max));
  return chunks.filter(Boolean).slice(0, MAX_CHUNKS);
}

function cacheKey(engine, voice, text) {
  return crypto.createHash('sha256').update(`${engine}|${voice}|${text}`).digest('hex');
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { ...value, exp: Date.now() + CACHE_TTL_MS });
}

function pcm16ToWav(pcm, sampleRate) {
  const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 24000;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function ensureWav(buffer, mime) {
  if (!buffer || !buffer.length) return buffer;
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF') return { buffer, mime: 'audio/wav' };
  const type = String(mime || '').toLowerCase();
  if (type.includes('mpeg') || type.includes('mp3')) return { buffer, mime: 'audio/mpeg' };
  if (type.includes('wav')) return { buffer, mime: 'audio/wav' };
  const rateMatch = type.match(/rate=(\d+)/i);
  const rate = rateMatch ? Number(rateMatch[1]) : 24000;
  return { buffer: pcm16ToWav(buffer, rate), mime: 'audio/wav' };
}

async function synthesizeElevenLabs(text, { previousText, nextText } = {}) {
  const voice = elevenVoiceId();
  const model = elevenModel();
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}` +
    '?output_format=mp3_44100_128';
  const body = {
    text,
    model_id: model,
    voice_settings: {
      stability: 0.48,
      similarity_boost: 0.78,
      style: 0.12,
      use_speaker_boost: true,
      speed: 0.98,
    },
  };
  if (/flash|turbo|v3/i.test(model)) body.language_code = 'cs';
  if (previousText) body.previous_text = String(previousText).slice(-400);
  if (nextText) body.next_text = String(nextText).slice(0, 400);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': elevenKey(),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const raw = await response.text();
    const err = new Error(`ElevenLabs TTS chyba (${response.status}) ${raw.slice(0, 180)}`);
    err.status = response.status;
    throw err;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    const err = new Error('ElevenLabs nevrátila audio.');
    err.status = 502;
    throw err;
  }
  return { buffer, mime: 'audio/mpeg', engine: 'elevenlabs', voice, model };
}

function extractInlineAudio(payload) {
  const parts =
    payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts
      ? payload.candidates[0].content.parts
      : [];
  for (const part of parts) {
    const inline = part && (part.inlineData || part.inline_data);
    if (inline && inline.data) {
      return {
        mime: inline.mimeType || inline.mime_type || 'audio/wav',
        buffer: Buffer.from(inline.data, 'base64'),
      };
    }
  }
  return null;
}

function requestBodies(text, voice) {
  return [
    {
      contents: [
        {
          role: 'user',
          parts: [{ text, speech_metadata: { style: GEMINI_STYLE } }],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          languageCode: 'cs-CZ',
          voiceConfig: { voice },
        },
      },
    },
    {
      contents: [
        {
          role: 'user',
          parts: [{ text, speechMetadata: { style: GEMINI_STYLE } }],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          languageCode: 'cs-CZ',
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    },
    {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          languageCode: 'cs-CZ',
          voiceConfig: { voice },
        },
      },
    },
  ];
}

async function generateGeminiOnce(model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': geminiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const msg =
      (payload && payload.error && payload.error.message) || `Gemini TTS chyba (${response.status})`;
    const err = new Error(msg);
    err.status = response.status;
    throw err;
  }
  const audio = extractInlineAudio(payload);
  if (!audio) {
    const err = new Error('Gemini TTS nevrátila audio.');
    err.status = 502;
    throw err;
  }
  return ensureWav(audio.buffer, audio.mime);
}

async function synthesizeGemini(text) {
  const voices = [...new Set([geminiVoice(), GEMINI_CZECH_VOICE, 'Kore'])];
  const models = ttsModels();
  let lastErr = null;
  for (const model of models) {
    for (const voice of voices) {
      for (const body of requestBodies(text, voice)) {
        try {
          const audio = await generateGeminiOnce(model, body);
          return { ...audio, engine: 'gemini', voice, model };
        } catch (err) {
          lastErr = err;
          const msg = String(err && err.message ? err.message : '');
          if (/not found|not supported|unknown name|invalid/i.test(msg)) break;
        }
      }
    }
  }
  throw lastErr || new Error('Audio se nepodařilo vytvořit.');
}

async function synthesizeChunk(text, options = {}) {
  const clean = normalizeCzechSpeech(text);
  if (!clean) {
    const err = new Error('Článek nemá text k přečtení.');
    err.code = 'EMPTY';
    throw err;
  }
  if (!isConfigured()) {
    const err = new Error('Audio komentář není nastavený.');
    err.status = 501;
    throw err;
  }

  const engines = [];
  if (elevenKey()) engines.push('elevenlabs');
  if (geminiKey()) engines.push('gemini');

  let lastErr = null;
  for (const engine of engines) {
    const voice = engine === 'elevenlabs' ? elevenVoiceId() : geminiVoice();
    const key = cacheKey(engine, voice, clean);
    const hit = cacheGet(key);
    if (hit) return { buffer: hit.buffer, mime: hit.mime, engine, voice };

    try {
      const audio =
        engine === 'elevenlabs'
          ? await synthesizeElevenLabs(clean, options)
          : await synthesizeGemini(clean);
      cacheSet(key, audio);
      return audio;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Audio se nepodařilo vytvořit.');
}

function getArticleChunks(slug) {
  const article = articlesService.getBySlug(slug);
  if (!article || article.status !== 'published') {
    const err = new Error('Článek nenalezen.');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const text = buildSpeakableText(article);
  if (!text) {
    const err = new Error('Článek nemá text k přečtení.');
    err.code = 'EMPTY';
    throw err;
  }
  const chunks = chunkText(text);
  return {
    article,
    chunks,
    voice: elevenKey() ? elevenVoiceId() : geminiVoice(),
  };
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function estimateDurationSec(article) {
  const text = buildSpeakableText(article);
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(20, Math.round(words / 2.2));
}

module.exports = {
  isConfigured,
  getArticleChunks,
  synthesizeChunk,
  chunkText,
  buildSpeakableText,
  estimateDurationSec,
  formatDuration,
};
