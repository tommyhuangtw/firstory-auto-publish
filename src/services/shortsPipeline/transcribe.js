/**
 * transcribe.js — OpenAI Whisper wrapper for podcast audio.
 *
 * Output shape (normalized across real / stub modes):
 *   {
 *     text: string,                                  // full transcript
 *     language: string,                              // detected language code
 *     duration: number,                              // seconds
 *     segments: [{ id, start, end, text }],          // sentence-level
 *     words:    [{ word, start, end }]               // word-level (for caption animation)
 *   }
 *
 * If OPENAI_API_KEY is not set, returns a deterministic STUB transcript so the
 * downstream pipeline can be developed end-to-end without an API key.
 *
 * Real mode uses the `gpt-4o-transcribe` / `whisper-1` REST endpoint with
 * `response_format=verbose_json` and `timestamp_granularities[]=word,segment`.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.WHISPER_MODEL || 'whisper-1'; // upgrade to 'gpt-4o-transcribe' once stable

/**
 * @param {string} audioPath - absolute path to audio file
 * @param {object} [opts]
 * @param {string} [opts.language='zh'] - ISO-639-1 code, hint for Whisper
 * @param {string} [opts.model] - override default model
 * @returns {Promise<TranscriptionResult>}
 */
async function transcribe(audioPath, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const language = opts.language || 'zh';
  const model = opts.model || DEFAULT_MODEL;

  if (!fs.existsSync(audioPath)) {
    throw new Error(`transcribe: audio file not found: ${audioPath}`);
  }

  if (!apiKey) {
    console.warn('⚠️  [transcribe] OPENAI_API_KEY not set — returning STUB transcript');
    return makeStubTranscript(audioPath);
  }

  console.log(`🎙️  [transcribe] Whisper (${model}) → ${path.basename(audioPath)}`);

  // Build multipart form-data manually (Node 18+ has global FormData & Blob)
  const fileBuffer = fs.readFileSync(audioPath);
  const fileBlob = new Blob([fileBuffer], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', fileBlob, path.basename(audioPath));
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('language', language);
  // Word-level timestamps — needed for animated captions later
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');

  const resp = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();

  return {
    text: data.text || '',
    language: data.language || language,
    duration: data.duration || 0,
    segments: (data.segments || []).map(s => ({
      id: s.id,
      start: s.start,
      end: s.end,
      text: s.text,
    })),
    words: (data.words || []).map(w => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  };
}

/**
 * Deterministic placeholder used when OPENAI_API_KEY is missing.
 * Returns a fake but structurally-valid transcript covering ~120 seconds so
 * the highlight extractor & Remotion render can be exercised.
 */
function makeStubTranscript(audioPath) {
  const fakeText =
    '大家好歡迎收聽 AI 懶人報。今天我們要聊一個非常有趣的主題：' +
    '為什麼 ChatGPT 在今年突然又進化了一大步，甚至能自己寫程式、自己 debug。' +
    '這對開發者來說是好事還是壞事？我認為這是一個轉捩點。' +
    '接下來我會分享三個你必須知道的關鍵變化，第一個是程式生成的品質，' +
    '第二個是 agent 的自主性，第三個是價格戰已經開始了。';

  const sentences = fakeText.split('。').filter(Boolean).map(s => s + '。');
  const segments = [];
  const words = [];
  let cursor = 0;
  sentences.forEach((sentence, idx) => {
    const dur = 6 + Math.random() * 4; // 6–10s per sentence
    const segStart = cursor;
    const segEnd = cursor + dur;
    segments.push({ id: idx, start: segStart, end: segEnd, text: sentence });

    // Approximate word splitting on Chinese: 2-char chunks
    const tokens = sentence.match(/.{1,2}/g) || [];
    const wDur = dur / Math.max(tokens.length, 1);
    tokens.forEach((tok, i) => {
      words.push({
        word: tok,
        start: segStart + i * wDur,
        end: segStart + (i + 1) * wDur,
      });
    });

    cursor = segEnd;
  });

  return {
    text: fakeText,
    language: 'zh',
    duration: cursor,
    segments,
    words,
    _stub: true,
  };
}

module.exports = { transcribe, makeStubTranscript };
