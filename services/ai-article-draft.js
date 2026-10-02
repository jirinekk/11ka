const DEFAULT_PROVIDER = 'gemini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function getProvider() {
  const raw = String(process.env.AI_DRAFT_PROVIDER || '').trim().toLowerCase();
  if (raw === 'gemini' || raw === 'openai' || raw === 'ollama') return raw;
  if (String(process.env.GEMINI_API_KEY || '').trim()) return 'gemini';
  if (String(process.env.OPENAI_API_KEY || '').trim()) return 'openai';
  return DEFAULT_PROVIDER;
}

function getOllamaBaseUrl() {
  return String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).trim().replace(/\/$/, '') || DEFAULT_OLLAMA_URL;
}

function getModel() {
  const provider = getProvider();
  if (provider === 'openai') {
    return String(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  }
  if (provider === 'ollama') {
    return String(process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
  }
  return String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
}

function isConfigured() {
  const provider = getProvider();
  if (provider === 'openai') return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  if (provider === 'gemini') return Boolean(String(process.env.GEMINI_API_KEY || '').trim());
  return true; // ollama - lokálně
}

function getSetupHint() {
  const provider = getProvider();
  if (provider === 'openai') {
    return 'Doplňte OPENAI_API_KEY v .env.';
  }
  if (provider === 'ollama') {
    return (
      'Nainstalujte Ollama na server webu a spusťte: ollama pull ' +
      getModel() +
      ' (nebo použijte AI_DRAFT_PROVIDER=gemini + GEMINI_API_KEY - zdarma, bez zapnutého PC).'
    );
  }
  return 'Zdarma pro web: vytvořte klíč na https://aistudio.google.com/apikey a doplňte GEMINI_API_KEY v .env na serveru.';
}

function buildPrompts({ brief, sourceNote, category }) {
  const source = String(sourceNote || '').trim().slice(0, 500);
  const cat = String(category || '').trim().slice(0, 80);

  const system = [
    'Jsi redaktor českého fotbalového média 11ka.cz.',
    'Z podkladu, který ti dodá redaktor, napiš ORIGINALNÍ článek v češtině.',
    'Nepřepisuj podklad větu po větě. Použij fakta z podkladu a vytvoř vlastní novinářský text.',
    'Styl: srozumitelný, aktuální, bez clickbaitu, bez emoji.',
    'Vrať POUZE platný JSON objekt bez markdownu ve tvaru:',
    '{"title":"...","excerpt":"...","paragraphs":["odstavec1","odstavec2"],"sources_line":"..."}',
    'title: max 110 znaků.',
    'excerpt: 1-2 věty, max 280 znaků.',
    'paragraphs: 4-8 odstavců, každý 2-5 vět.',
    'sources_line: text zdroje, který redaktor uvedl; pokud chybí, prázdný string.',
  ].join(' ');

  const user = [
    cat ? `Rubrika: ${cat}` : '',
    source ? `Zdroj (uvést u článku): ${source}` : 'Zdroj: (neuveden)',
    '',
    'Podklad od redaktora:',
    brief,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user, source };
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeDraft(parsed, sourceFallback) {
  const title = String(parsed.title || '')
    .trim()
    .slice(0, 160);
  const excerpt = String(parsed.excerpt || '')
    .trim()
    .slice(0, 400);
  const paragraphs = Array.isArray(parsed.paragraphs)
    ? parsed.paragraphs
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
  let sourcesLine = String(parsed.sources_line || '')
    .trim()
    .slice(0, 500);
  if (!sourcesLine && sourceFallback) sourcesLine = sourceFallback;

  if (!title || paragraphs.length < 2) {
    const err = new Error('AI návrh je neúplný. Zkuste znovu nebo doplňte podklad.');
    err.code = 'INCOMPLETE_DRAFT';
    throw err;
  }

  return {
    title,
    excerpt,
    paragraphs,
    sources: sourcesLine,
    model: getModel(),
    provider: getProvider(),
  };
}

async function generateViaOpenAI({ system, user, source }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('Chybí OPENAI_API_KEY v .env');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const rawText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg =
      (payload && payload.error && payload.error.message) ||
      `OpenAI API chyba (${response.status})`;
    const err = new Error(msg);
    err.code = 'OPENAI_ERROR';
    throw err;
  }

  const content =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    payload.choices[0].message.content
      ? String(payload.choices[0].message.content)
      : '';

  const parsed = extractJsonObject(content);
  if (!parsed) {
    const err = new Error('AI nevrátila platný JSON.');
    err.code = 'BAD_AI_JSON';
    throw err;
  }
  return normalizeDraft(parsed, source);
}

function geminiModelChain() {
  const extras = String(process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set(
      [
        getModel(),
        ...extras,
        'gemini-flash-latest',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.5-flash-lite',
        'gemini-3.6-flash',
      ].filter(Boolean)
    ),
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geminiErrorFlags(status, message) {
  const msg = String(message || '');
  const lower = msg.toLowerCase();
  const unavailable = /no longer available|not found|is not found|not supported/i.test(msg);
  const highDemand =
    status === 429 ||
    status === 503 ||
    status === 500 ||
    /high demand|unavailable|overloaded|try again later|resource exhausted|quota/i.test(lower);
  return { unavailable, retryable: highDemand && !unavailable };
}

async function generateViaGeminiOnce(model, { system, user, source }) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: 'application/json',
      },
    }),
  });

  const rawText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg =
      (payload && payload.error && payload.error.message) ||
      `Gemini API chyba (${response.status})`;
    const flags = geminiErrorFlags(response.status, msg);
    const err = new Error(msg);
    err.code = 'GEMINI_ERROR';
    err.retryable = flags.retryable;
    err.unavailable = flags.unavailable;
    throw err;
  }

  const content =
    payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts &&
    payload.candidates[0].content.parts[0] &&
    payload.candidates[0].content.parts[0].text
      ? String(payload.candidates[0].content.parts[0].text)
      : '';

  const parsed = extractJsonObject(content);
  if (!parsed) {
    const err = new Error('AI nevrátila platný JSON.');
    err.code = 'BAD_AI_JSON';
    err.retryable = true;
    throw err;
  }
  const draft = normalizeDraft(parsed, source);
  draft.model = model;
  return draft;
}

async function generateViaGemini(prompts) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error(getSetupHint());
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  let lastErr = null;
  for (const model of geminiModelChain()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await generateViaGeminiOnce(model, prompts);
      } catch (err) {
        lastErr = err;
        if (err && err.unavailable) break;
        if (err && err.retryable && attempt === 0) {
          await sleep(700 + Math.floor(Math.random() * 500));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr || new Error('Gemini API chyba');
}

async function generateViaOllama({ system, user, source }) {
  const baseUrl = getOllamaBaseUrl();
  const model = getModel();

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.5 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (e) {
    const err = new Error(
      `Ollama neběží na ${baseUrl}. Pro web bez PC použijte GEMINI_API_KEY (AI_DRAFT_PROVIDER=gemini).`
    );
    err.code = 'OLLAMA_DOWN';
    throw err;
  }

  const rawText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const msg =
      (payload && (payload.error || payload.message)) ||
      `Ollama chyba (${response.status}). Máte stažený model? ollama pull ${model}`;
    const err = new Error(String(msg));
    err.code = 'OLLAMA_ERROR';
    throw err;
  }

  const content =
    payload && payload.message && payload.message.content
      ? String(payload.message.content)
      : payload && payload.response
        ? String(payload.response)
        : '';

  const parsed = extractJsonObject(content);
  if (!parsed) {
    const err = new Error('Lokální AI nevrátila platný JSON. Zkuste znovu nebo jiný model (OLLAMA_MODEL).');
    err.code = 'BAD_AI_JSON';
    throw err;
  }
  return normalizeDraft(parsed, source);
}

/**
 * Vytvoří návrh článku z podkladu, který vložil redaktor.
 * Default: Gemini (zdarma v cloudu, běží na serveru webu).
 */
async function generateArticleDraft({ brief, sourceNote, category }) {
  const cleanBrief = String(brief || '').trim();
  if (cleanBrief.length < 40) {
    const err = new Error('Podklad musí mít alespoň 40 znaků.');
    err.code = 'BRIEF_TOO_SHORT';
    throw err;
  }
  if (cleanBrief.length > 12000) {
    const err = new Error('Podklad je příliš dlouhý (max. 12 000 znaků).');
    err.code = 'BRIEF_TOO_LONG';
    throw err;
  }

  const prompts = buildPrompts({
    brief: cleanBrief,
    sourceNote,
    category,
  });

  const provider = getProvider();
  if (provider === 'openai') return generateViaOpenAI(prompts);
  if (provider === 'ollama') return generateViaOllama(prompts);
  return generateViaGemini(prompts);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function draftToBodyHtml(paragraphs) {
  return (paragraphs || [])
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

function draftToBlocksJson(paragraphs) {
  const blocks = (paragraphs || []).map((p) => ({
    type: 'paragraph',
    data: { text: String(p) },
  }));
  return JSON.stringify(blocks);
}

module.exports = {
  isConfigured,
  getModel,
  getProvider,
  getSetupHint,
  generateArticleDraft,
  draftToBodyHtml,
  draftToBlocksJson,
};
