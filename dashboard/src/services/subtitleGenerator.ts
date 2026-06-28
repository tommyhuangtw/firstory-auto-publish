/**
 * Subtitle Generator — Whisper transcription + script alignment + SRT generation.
 *
 * Flow:
 * 1. Transcribe TTS audio via OpenAI Whisper → get segments with timestamps
 * 2. Align original script sentences to Whisper segments (sequential character matching)
 * 3. Group aligned sentences into subtitle cues following formatting rules
 * 4. Generate standard SRT output
 *
 * Formatting rules:
 * - 1-2 sentences per subtitle (3 only if all very short)
 * - Max 2 lines per subtitle
 * - No punctuation marks
 * - English words never split across lines
 * - Use original script text, NOT Whisper transcription text
 */

import fs from 'fs';
import path from 'path';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';

const log = createChildLogger('subtitleGenerator');

const OPENAI_API_BASE = 'https://api.openai.com/v1';

// ── Types ──

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  duration: number;
  segments: WhisperSegment[];
  words: WhisperWord[];
}

export interface AlignedSentence {
  text: string;
  startTime: number;
  endTime: number;
  matchScore: number;
}

export interface SubtitleCue {
  index: number;
  startTime: number;
  endTime: number;
  lines: string[];
}

// ── 1. Whisper Transcription ──

export async function transcribeAudio(
  audioPath: string,
  opts: { language?: string; model?: string; maxDurationSec?: number; chunkLongAudio?: boolean } = {}
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const language = opts.language || 'zh';
  const model = opts.model || process.env.WHISPER_MODEL || 'whisper-1';

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  log.info({ model, audioPath: path.basename(audioPath) }, 'Starting Whisper transcription');

  let inputPath = audioPath;
  const maxDuration = opts.maxDurationSec;

  // If maxDuration specified, trim audio first
  if (maxDuration && maxDuration > 0) {
    const { execSync } = await import('child_process');
    const trimmedPath = audioPath.replace(/\.mp3$/, `_trim${maxDuration}s.mp3`);
    execSync(
      `ffmpeg -y -nostdin -i "${audioPath}" -t ${maxDuration} -c copy "${trimmedPath}"`,
      { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
    );
    inputPath = trimmedPath;
  }

  // ── Long-audio path: split into time chunks and stitch (opt-in via chunkLongAudio).
  //    Avoids undici's 5-min fetch timeout on big uploads AND the quality loss from
  //    crushing a long file under 25MB. The main show pipeline does NOT set this flag,
  //    so its behavior is unchanged. ──
  if (opts.chunkLongAudio) {
    const durationSec = await getAudioDurationSec(inputPath);
    if (durationSec && durationSec > CHUNK_SEC) {
      try {
        const merged = await transcribeInChunks(inputPath, durationSec, model, language, apiKey);
        log.info(
          { segments: merged.segments.length, words: merged.words.length, duration: merged.duration },
          'Whisper transcription complete (chunked)'
        );
        return merged;
      } finally {
        if (inputPath !== audioPath) { try { fs.unlinkSync(inputPath); } catch { /* ignore */ } }
      }
    }
  }

  // ── Auto-compress if file exceeds Whisper's 25MB limit ──
  const MAX_WHISPER_SIZE = 26_000_000; // safety margin below 26,214,400
  const stat = fs.statSync(inputPath);
  if (stat.size > MAX_WHISPER_SIZE) {
    const { execSync } = await import('child_process');
    const compressedPath = inputPath.replace(/\.mp3$/, '_compressed.mp3');
    log.info(
      { originalSize: stat.size, target: compressedPath },
      'Audio exceeds 25MB Whisper limit, compressing to lower bitrate'
    );
    // Step down iteratively: try 64k first, then 32k if still too large
    const bitrates = ['64k', '32k'];
    let success = false;
    for (const bitrate of bitrates) {
      execSync(
        `ffmpeg -y -nostdin -i "${inputPath}" -b:a ${bitrate} -ac 1 "${compressedPath}"`,
        { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
      );
      const compressedSize = fs.statSync(compressedPath).size;
      if (compressedSize <= MAX_WHISPER_SIZE) {
        log.info({ bitrate, compressedSize }, 'Compression successful');
        success = true;
        break;
      }
      log.warn({ bitrate, compressedSize }, 'Still over limit, trying lower bitrate');
    }
    if (success) {
      inputPath = compressedPath;
    } else {
      log.error('Could not compress audio below 25MB even at 32k — proceeding with compressed file');
      inputPath = compressedPath;
    }
  }

  const result = await whisperTranscribeFile(inputPath, model, language, apiKey);

  // Clean up trimmed/compressed file
  if (inputPath !== audioPath) {
    try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
  }

  log.info(
    { segments: result.segments.length, words: result.words.length, duration: result.duration },
    'Whisper transcription complete'
  );

  return result;
}

// ── Whisper helpers ──

/** Upload one audio file to Whisper and map the verbose_json response. */
async function whisperTranscribeFile(
  filePath: string, model: string, language: string, apiKey: string,
): Promise<TranscriptionResult> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileBlob = new Blob([fileBuffer], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', fileBlob, path.basename(filePath));
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('language', language);
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');

  const resp = await withRetry(
    async () => {
      const r = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(`Whisper API error ${r.status}: ${errText}`);
      }
      return r;
    },
    { label: 'whisper-transcription', maxRetries: 3 },
  );

  const data = await resp.json();
  return {
    text: data.text || '',
    language: data.language || language,
    duration: data.duration || 0,
    segments: (data.segments || []).map((s: Record<string, unknown>) => ({
      id: s.id as number,
      start: s.start as number,
      end: s.end as number,
      text: s.text as string,
    })),
    words: (data.words || []).map((w: Record<string, unknown>) => ({
      word: w.word as string,
      start: w.start as number,
      end: w.end as number,
    })),
  };
}

/** Probe audio duration in seconds via ffprobe; null if unavailable. */
async function getAudioDurationSec(filePath: string): Promise<number | null> {
  try {
    const { execSync } = await import('child_process');
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${filePath}"`,
      { stdio: 'pipe' },
    ).toString().trim();
    const d = parseFloat(out);
    return isFinite(d) && d > 0 ? d : null;
  } catch { return null; }
}

// 10-min chunks: small upload, well under Whisper's 25MB cap and the 5-min fetch timeout.
const CHUNK_SEC = 600;

/**
 * Transcribe a long audio file by splitting into CHUNK_SEC slices and stitching the
 * results with offset timestamps. Each chunk is re-encoded to 16kHz mono (Whisper-optimal,
 * tiny, good speech quality). Segment/word times are shifted by the chunk's start offset so
 * the merged timeline matches the original audio.
 */
async function transcribeInChunks(
  filePath: string, durationSec: number, model: string, language: string, apiKey: string,
): Promise<TranscriptionResult> {
  const { execSync } = await import('child_process');
  const numChunks = Math.ceil(durationSec / CHUNK_SEC);
  log.info({ durationSec: Math.round(durationSec), numChunks, chunkSec: CHUNK_SEC }, 'Long audio — transcribing in chunks');

  const merged: TranscriptionResult = { text: '', language, duration: durationSec, segments: [], words: [] };
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SEC;
    const chunkPath = filePath.replace(/\.mp3$/i, `_chunk${i}.mp3`);
    execSync(
      `ffmpeg -y -nostdin -ss ${start} -t ${CHUNK_SEC} -i "${filePath}" -ar 16000 -ac 1 -b:a 64k "${chunkPath}"`,
      { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 },
    );
    try {
      const part = await whisperTranscribeFile(chunkPath, model, language, apiKey);
      merged.text += (merged.text ? ' ' : '') + part.text;
      for (const s of part.segments) merged.segments.push({ id: merged.segments.length, start: s.start + start, end: s.end + start, text: s.text });
      for (const w of part.words) merged.words.push({ word: w.word, start: w.start + start, end: w.end + start });
      log.info({ chunk: i + 1, of: numChunks, textLen: part.text.length }, 'Chunk transcribed');
    } finally {
      try { fs.unlinkSync(chunkPath); } catch { /* ignore */ }
    }
  }
  return merged;
}

// ── 2. Script-to-Transcript Alignment ──

/** Remove all Chinese/English punctuation for comparison. */
function normalize(text: string): string {
  return text
    .replace(/[。，！？、；：「」（）【】《》〈〉…─—\-,.!?;:'"()\[\]{}<>\/\\~`@#$%^&*_+=|·\s]/g, '')
    .trim();
}

/** Split script into sentences on Chinese sentence-ending punctuation and newlines. */
export function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation or newlines
  const raw = text.split(/(?<=[。！？])|(?:\n+)/);
  return raw
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

interface CharTime {
  char: string;
  time: number;
}

/** Build a character-to-time mapping from Whisper segments. */
function buildCharTimeMap(segments: WhisperSegment[]): CharTime[] {
  const charTimes: CharTime[] = [];
  for (const seg of segments) {
    const chars = normalize(seg.text).split('');
    if (chars.length === 0) continue;
    const duration = seg.end - seg.start;
    for (let i = 0; i < chars.length; i++) {
      charTimes.push({
        char: chars[i],
        time: seg.start + (i / chars.length) * duration,
      });
    }
  }
  return charTimes;
}

/**
 * Greedy forward subsequence match with limited skip tolerance.
 * For each character in `needle`, search forward in charTimes up to
 * `SKIP_TOLERANCE` positions. If not found within that range, mark as
 * unmatched and try the next needle character WITHOUT advancing the scan cursor.
 * This prevents a single missing character from causing the match to jump
 * far ahead and consume future sentences' characters.
 */
function subsequenceMatch(
  needle: string,
  charTimes: CharTime[],
  startPos: number,
  maxScan: number
): { matched: number; lastMatchIdx: number } {
  const SKIP_TOLERANCE = 5; // max positions to look ahead per character
  let matched = 0;
  let scanIdx = startPos;
  let lastMatchIdx = startPos;
  const scanEnd = Math.min(startPos + maxScan, charTimes.length);

  for (let ni = 0; ni < needle.length && scanIdx < scanEnd; ni++) {
    const lookAheadEnd = Math.min(scanIdx + SKIP_TOLERANCE, scanEnd);
    let found = false;
    for (let si = scanIdx; si < lookAheadEnd; si++) {
      if (needle[ni] === charTimes[si].char) {
        matched++;
        lastMatchIdx = si;
        scanIdx = si + 1;
        found = true;
        break;
      }
    }
    // If not found within tolerance, don't advance scanIdx — just skip this needle char
  }
  return { matched, lastMatchIdx };
}

/** Align original script sentences to Whisper timestamp data. */
export function alignSentences(
  scriptSentences: string[],
  segments: WhisperSegment[]
): AlignedSentence[] {
  const charTimes = buildCharTimeMap(segments);
  if (charTimes.length === 0) {
    log.warn('No characters in Whisper segments, returning empty alignment');
    return [];
  }

  let cursor = 0;
  const results: AlignedSentence[] = [];

  for (const sentence of scriptSentences) {
    const normSentence = normalize(sentence);
    if (normSentence.length === 0) continue;

    // If cursor is past the Whisper data, stop aligning
    if (cursor >= charTimes.length) {
      log.info(
        { remaining: scriptSentences.length - results.length },
        'Cursor past Whisper data, stopping alignment'
      );
      break;
    }

    // Search forward from cursor for the best starting position.
    // Use subsequence matching which handles insertions/deletions gracefully.
    const searchRange = Math.min(normSentence.length * 2, charTimes.length - cursor);
    // Max scan length for each subsequence match attempt
    const maxScan = normSentence.length * 2;

    let bestPos = cursor;
    let bestScore = 0;
    let bestLastIdx = cursor;

    // Try starting positions in a limited range ahead of cursor
    const tryPositions = Math.min(searchRange, 30); // don't try too many positions
    for (let offset = 0; offset < tryPositions; offset++) {
      const pos = cursor + offset;
      if (pos >= charTimes.length) break;

      const { matched, lastMatchIdx } = subsequenceMatch(
        normSentence, charTimes, pos, maxScan
      );
      const score = matched / normSentence.length;

      if (score > bestScore) {
        bestScore = score;
        bestPos = pos;
        bestLastIdx = lastMatchIdx;
      }
      // Early exit on excellent match
      if (score >= 0.9) break;
    }

    // If score is very low near end of Whisper data, stop
    if (bestScore < 0.15 && cursor > charTimes.length * 0.7) {
      log.info(
        { score: bestScore.toFixed(2), sentence: sentence.slice(0, 30) },
        'Low score near end of Whisper data, stopping'
      );
      break;
    }

    const startTime = charTimes[bestPos]?.time ?? 0;
    const endTime = charTimes[bestLastIdx]?.time ?? (startTime + 2);

    results.push({
      text: sentence,
      startTime,
      endTime,
      matchScore: bestScore,
    });

    // Advance cursor past this match
    cursor = Math.min(bestLastIdx + 1, charTimes.length);
  }

  // Log alignment quality
  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.matchScore, 0) / results.length
    : 0;
  const lowScoreCount = results.filter(r => r.matchScore < 0.5).length;
  log.info(
    { sentences: results.length, avgScore: avgScore.toFixed(3), lowScoreCount },
    'Script alignment complete'
  );

  return results;
}

// ── 3. Subtitle Segmentation ──

const CHINESE_PUNCTUATION = /[。，！？、；：「」（）【】《》〈〉…─—''""·]/g;
const LINE_MAX_WIDTH = 16; // max display-width chars per subtitle line
const LINE_MIN_WIDTH = 4;  // min display-width chars (merge short fragments)
const MAX_LINES = 2;       // max lines per subtitle cue

/**
 * Force-split text into chunks that each fit LINE_MAX_WIDTH, used for long
 * sentences that have no comma/clause punctuation to break on. CJK splits at any
 * char boundary; ASCII words/numbers are never split mid-token.
 */
function forceSplitByWidth(text: string, maxWidth: number): string[] {
  const chars = [...text];
  const out: string[] = [];
  let cur = '';
  let curW = 0;
  let i = 0;
  while (i < chars.length) {
    let token = chars[i];
    if (/[A-Za-z0-9]/.test(chars[i])) {
      let j = i + 1;
      while (j < chars.length && /[A-Za-z0-9'’.\-]/.test(chars[j])) { token += chars[j]; j++; }
      i = j;
    } else {
      i++;
    }
    const tW = displayWidth(removePunctuation(token));
    if (curW > 0 && curW + tW > maxWidth) {
      out.push(cur);
      cur = token;
      curW = tW;
    } else {
      cur += token;
      curW += tW;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Remove all punctuation from text for subtitle display. */
export function removePunctuation(text: string): string {
  return text
    .replace(CHINESE_PUNCTUATION, '')
    .replace(/[,.!?;:'"()\[\]{}<>\/\\~`@#$%^&*_+=|]/g, '')
    .trim();
}

/**
 * Calculate display width: Chinese/full-width chars = 1, ASCII chars = 0.5.
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[\x00-\x7F]/.test(ch) ? 0.5 : 1;
  }
  return width;
}

/**
 * Break a long sentence into sub-parts that each fit within LINE_MAX_WIDTH.
 * Splits at comma/clause boundaries first; if still too long, splits at
 * any valid character boundary (not inside English words).
 * Returns AlignedSentence[] with interpolated timestamps.
 */
function breakLongSentence(item: AlignedSentence): AlignedSentence[] {
  const text = item.text;
  // Split at Chinese commas and clause markers
  const parts = text.split(/(?<=[，、；])/);

  // Group parts so each group fits in LINE_MAX_WIDTH
  // Peek ahead: if remaining parts are too short, absorb them
  const groups: string[] = [];
  let current = '';
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const combined = current + part;
    if (current && displayWidth(removePunctuation(combined)) > LINE_MAX_WIDTH) {
      // Check if remaining parts (from pi onward) are too short to stand alone
      const remainingText = parts.slice(pi).join('');
      if (displayWidth(removePunctuation(remainingText)) < LINE_MIN_WIDTH) {
        // Absorb into current (let force-split handle the overflow)
        current = combined;
      } else {
        groups.push(current);
        current = part;
      }
    } else {
      current = combined;
    }
  }
  if (current) groups.push(current);

  // Force-split any group still over width (e.g. a long run-on sentence with no
  // comma to break on) at character boundaries.
  const finalGroups: string[] = [];
  for (const g of groups) {
    if (displayWidth(removePunctuation(g)) > LINE_MAX_WIDTH) {
      finalGroups.push(...forceSplitByWidth(g, LINE_MAX_WIDTH));
    } else {
      finalGroups.push(g);
    }
  }

  // Merge back any fragment that's under LINE_MIN_WIDTH (try prev, then next)
  for (let i = finalGroups.length - 1; i >= 0; i--) {
    const gClean = removePunctuation(finalGroups[i]);
    if (displayWidth(gClean) >= LINE_MIN_WIDTH) continue;
    // Try merge with previous
    if (i > 0) {
      const merged = removePunctuation(finalGroups[i - 1] + finalGroups[i]);
      if (displayWidth(merged) <= LINE_MAX_WIDTH) {
        finalGroups[i - 1] = finalGroups[i - 1] + finalGroups[i];
        finalGroups.splice(i, 1);
        continue;
      }
    }
    // Try merge with next
    if (i < finalGroups.length - 1) {
      const merged = removePunctuation(finalGroups[i] + finalGroups[i + 1]);
      if (displayWidth(merged) <= LINE_MAX_WIDTH) {
        finalGroups[i + 1] = finalGroups[i] + finalGroups[i + 1];
        finalGroups.splice(i, 1);
        continue;
      }
    }
    // Neither fits — keep as-is (will be handled by post-process in segmentSubtitles)
  }

  if (finalGroups.length <= 1) return [item];

  // Interpolate timestamps based on character proportion
  const totalChars = removePunctuation(text).length || 1;
  const totalDuration = item.endTime - item.startTime;
  let charCursor = 0;

  return finalGroups.map(g => {
    const gText = removePunctuation(g);
    const gChars = gText.length;
    const startTime = item.startTime + (charCursor / totalChars) * totalDuration;
    charCursor += gChars;
    const endTime = item.startTime + (charCursor / totalChars) * totalDuration;
    return {
      text: g,
      startTime,
      endTime,
      matchScore: item.matchScore,
    };
  });
}

/**
 * Group aligned sentences into subtitle cues.
 * Rules:
 * - Each cue has up to MAX_LINES (2) lines
 * - Target LINE_MAX_WIDTH (18) display-width per line; over-width lines are kept intact (no force-split)
 * - Min LINE_MIN_WIDTH (4) display-width — merge short fragments with neighbors
 */
export function segmentSubtitles(aligned: AlignedSentence[]): SubtitleCue[] {
  // Step 1: Break long sentences into parts that fit in LINE_MAX_WIDTH
  const expanded: AlignedSentence[] = [];
  for (const item of aligned) {
    const cleaned = removePunctuation(item.text);
    if (displayWidth(cleaned) > LINE_MAX_WIDTH) {
      expanded.push(...breakLongSentence(item));
    } else {
      expanded.push(item);
    }
  }

  // Step 2: Build cues — multi-line pending buffer (up to MAX_LINES lines per cue)
  const cues: SubtitleCue[] = [];
  let pendingLines: string[] = [];
  let pendingStart = 0;
  let pendingEnd = 0;

  const flushPending = () => {
    if (pendingLines.length === 0) return;
    cues.push({
      index: cues.length + 1,
      startTime: pendingStart,
      endTime: pendingEnd,
      lines: [...pendingLines],
    });
    pendingLines = [];
  };

  for (const item of expanded) {
    const cleaned = removePunctuation(item.text);
    if (!cleaned) continue;

    if (pendingLines.length === 0) {
      // Start new pending
      pendingLines = [cleaned];
      pendingStart = item.startTime;
      pendingEnd = item.endTime;
      continue;
    }

    // Try merging into the last line (space separator)
    const lastLine = pendingLines[pendingLines.length - 1];
    const mergedLine = lastLine + ' ' + cleaned;
    if (displayWidth(mergedLine) <= LINE_MAX_WIDTH) {
      pendingLines[pendingLines.length - 1] = mergedLine;
      pendingEnd = item.endTime;
      continue;
    }

    // Can't fit on last line — try adding a new line to this cue
    if (pendingLines.length < MAX_LINES && displayWidth(cleaned) <= LINE_MAX_WIDTH) {
      pendingLines.push(cleaned);
      pendingEnd = item.endTime;
      continue;
    }

    // Cue is full — flush and start new
    flushPending();
    pendingLines = [cleaned];
    pendingStart = item.startTime;
    pendingEnd = item.endTime;
  }
  flushPending();

  // Post-process: merge any under-width cues with neighbors
  const final: SubtitleCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    // Check if cue's last line is under minimum width
    const lastLine = cue.lines[cue.lines.length - 1];
    const lastWidth = displayWidth(lastLine);

    if (lastWidth < LINE_MIN_WIDTH && final.length > 0) {
      // Try merge into previous cue's last line
      const prev = final[final.length - 1];
      const prevLastLine = prev.lines[prev.lines.length - 1];
      const mergedWithPrevLine = prevLastLine + ' ' + lastLine;
      if (displayWidth(mergedWithPrevLine) <= LINE_MAX_WIDTH) {
        prev.lines[prev.lines.length - 1] = mergedWithPrevLine;
        prev.endTime = cue.endTime;
        continue;
      }
      // Try adding as new line to previous cue
      if (prev.lines.length < MAX_LINES) {
        prev.lines.push(lastLine);
        prev.endTime = cue.endTime;
        continue;
      }
    }
    if (lastWidth < LINE_MIN_WIDTH && i + 1 < cues.length) {
      // Try merge into next cue's first line
      const next = cues[i + 1];
      const mergedWithNextLine = lastLine + ' ' + next.lines[0];
      if (displayWidth(mergedWithNextLine) <= LINE_MAX_WIDTH) {
        next.lines[0] = mergedWithNextLine;
        next.startTime = cue.startTime;
        continue;
      }
      // Try prepending as first line of next cue
      if (next.lines.length < MAX_LINES) {
        next.lines.unshift(lastLine);
        next.startTime = cue.startTime;
        continue;
      }
    }
    final.push(cue);
  }

  // Re-index
  for (let i = 0; i < final.length; i++) {
    final[i].index = i + 1;
  }

  return final;
}

// ── 4. SRT Generation ──

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

export function generateSRT(cues: SubtitleCue[]): string {
  return cues
    .map(cue =>
      [
        String(cue.index),
        `${formatSRTTime(cue.startTime)} --> ${formatSRTTime(cue.endTime)}`,
        cue.lines.join('\n'),
        '',
      ].join('\n')
    )
    .join('\n');
}

function srtTimeToSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/** Parse an SRT string back into cues (tolerates ',' or '.' ms separators). */
export function parseSRT(srt: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = srt.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const tsIdx = lines.findIndex(l => l.includes('-->'));
    if (tsIdx === -1) continue;
    const m = lines[tsIdx].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!m) continue;
    const startTime = srtTimeToSeconds(m[1], m[2], m[3], m[4]);
    const endTime = srtTimeToSeconds(m[5], m[6], m[7], m[8]);
    const textLines = lines.slice(tsIdx + 1).filter(l => l.trim() !== '');
    cues.push({ index: cues.length + 1, startTime, endTime, lines: textLines });
  }
  return cues;
}

/**
 * Shift every cue in an SRT by offsetSec (use when audio is prepended/removed).
 * The episode portion is unchanged in content — only delayed — so this is exact
 * and avoids re-running Whisper. The prepended sponsor segment is left
 * un-subtitled (a short ad read), matching common podcast captioning.
 */
/**
 * Concatenate multiple SRT strings (each already on the correct absolute
 * timeline) into one, re-indexing cues sequentially. Empty inputs are skipped.
 */
export function mergeSRTSegments(...srtContents: (string | null | undefined)[]): string {
  const cues = srtContents
    .filter((s): s is string => !!s && s.trim() !== '')
    .flatMap(s => parseSRT(s));
  cues.forEach((c, i) => { c.index = i + 1; });
  return generateSRT(cues);
}

export function shiftSRTContent(srt: string, offsetSec: number): string {
  if (!srt?.trim()) return srt;
  const shifted = parseSRT(srt).map((c, i) => ({
    ...c,
    index: i + 1,
    startTime: Math.max(0, c.startTime + offsetSec),
    endTime: Math.max(0, c.endTime + offsetSec),
  }));
  return generateSRT(shifted);
}

// ── Chunk-timing path (Approach A — no transcription) ──

/**
 * One synthesized TTS chunk and where it lands on the final audio timeline.
 * `text` is the exact text that was spoken; `[startSec, endSec]` come from
 * ffprobe-ing the chunk's own duration and accumulating offsets at concat time.
 */
export interface ChunkTiming {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Build subtitles directly from TTS chunk timings — the robust path.
 *
 * We synthesize the script chunk-by-chunk, so each chunk's text is ground truth
 * and its position on the timeline is exact (every chunk boundary is frame-accurate,
 * so errors never accumulate). Within a chunk we split into sentences and interpolate
 * by character proportion, then reuse the same segmentation/line-breaking rules as
 * the Whisper path. This eliminates the Whisper-truncation drift entirely.
 */
export function buildSubtitlesFromChunks(chunks: ChunkTiming[]): {
  srtContent: string;
  aligned: AlignedSentence[];
  cues: SubtitleCue[];
} {
  const aligned: AlignedSentence[] = [];

  for (const ch of chunks) {
    const span = Math.max(0, ch.endSec - ch.startSec);
    const sentences = splitSentences(ch.text);
    if (sentences.length === 0) continue;

    // Distribute the chunk's time span across its sentences by visible char count.
    const lens = sentences.map(s => normalize(s).length || 1);
    const total = lens.reduce((a, b) => a + b, 0) || 1;

    let cursor = 0;
    for (let i = 0; i < sentences.length; i++) {
      const startTime = ch.startSec + (cursor / total) * span;
      cursor += lens[i];
      const endTime = ch.startSec + (cursor / total) * span;
      aligned.push({ text: sentences[i], startTime, endTime, matchScore: 1 });
    }
  }

  const cues = segmentSubtitles(aligned);
  const srtContent = generateSRT(cues);
  return { srtContent, aligned, cues };
}

/**
 * Coverage = how far into the audio the last subtitle cue reaches.
 * < ~0.95 means the subtitles stop well before the audio ends — the signature of
 * the Whisper-truncation bug. Used as a guard on the Whisper fallback path.
 */
export function srtCoverage(srtContent: string, audioDurationSec: number): number {
  if (!srtContent?.trim() || !audioDurationSec || audioDurationSec <= 0) return 0;
  const cues = parseSRT(srtContent);
  if (cues.length === 0) return 0;
  const lastEnd = cues[cues.length - 1].endTime;
  return lastEnd / audioDurationSec;
}

// ── Public API: Full Pipeline ──

/**
 * Transcribe audio and align original script to generate SRT content.
 *
 * @param audioPath - Path to the audio file (may include sponsor prefix)
 * @param scriptText - Full script text (sponsor + main, in order)
 * @param opts - Optional: maxDurationSec to limit transcription
 * @returns { srtContent, transcription, aligned, cues }
 */
export async function generateSubtitles(
  audioPath: string,
  scriptText: string,
  opts: { maxDurationSec?: number; chunkLongAudio?: boolean } = {}
): Promise<{
  srtContent: string;
  transcription: TranscriptionResult;
  aligned: AlignedSentence[];
  cues: SubtitleCue[];
}> {
  // Step 1: Transcribe
  const transcription = await transcribeAudio(audioPath, {
    maxDurationSec: opts.maxDurationSec,
    chunkLongAudio: opts.chunkLongAudio,
  });

  // Step 2: Split script and align
  const sentences = splitSentences(scriptText);
  log.info({ sentenceCount: sentences.length }, 'Script split into sentences');

  const aligned = alignSentences(sentences, transcription.segments);

  // Step 3: Segment into subtitle cues
  const cues = segmentSubtitles(aligned);

  // Step 4: Generate SRT
  const srtContent = generateSRT(cues);

  log.info(
    { cueCount: cues.length, srtLength: srtContent.length },
    'SRT generated'
  );

  return { srtContent, transcription, aligned, cues };
}
