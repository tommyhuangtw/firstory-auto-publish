/**
 * shortsPipeline/index.js — orchestration for the 40–60s podcast highlight pipeline.
 *
 * All-TTS approach: the entire Shorts is narrated by the sloth character via VoAI.
 * No original podcast audio is used — only the Airtable script + selected beat.
 *
 * Phases (each stage gracefully degrades to a stub when its API key is absent):
 *   1. extractHighlight  — Gemini writes narration script from selected beat
 *   2. ttsNarration      — VoAI synthesises hook + narration + outro
 *   3. whisperTTS        — Whisper on TTS audio for word-level caption timestamps
 *   4. slothVideo        — Kling 2.6 I2V from pre-generated sloth images
 *   5. fetchBroll        — Pexels downloads B-roll matching keywords
 *   6. concatMasterAudio — hook + narration + outro, one master track
 *   7. buildRemotionProps + render — assemble props & produce final 9:16 MP4
 *
 * Returns the final output path + a manifest describing every intermediate.
 */

const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const { transcribe } = require('./transcribe');
const { extractHighlight } = require('./highlightExtractor');
const { concatAudio, getDuration } = require('./audioCutter');
const { synthesize } = require('./voai');
const { fetchAll: fetchBrollAll } = require('./pexels');
const { generateHeroBroll, generateSlothVideo, SLOTH_HOOK_PROMPT, SLOTH_OUTRO_PROMPT } = require('./kieai');
const glob = require('glob');

const execAsync = promisify(exec);

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const REMOTION_DIR = path.join(PROJECT_ROOT, 'remotion');
const SLOTH_IMAGES_DIR = path.join(REMOTION_DIR, 'public');

/** Concatenate multiple video files using FFmpeg concat demuxer. */
async function concatVideo(inputPaths, outPath) {
  const listFile = outPath + '.txt';
  const content = inputPaths.map(p => `file '${p}'`).join('\n');
  await fs.writeFile(listFile, content);
  await execAsync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outPath}"`);
  await fs.remove(listFile);
}

/** Pick a random pre-generated sloth studio image. */
function pickRandomSlothImage() {
  const pattern = path.join(SLOTH_IMAGES_DIR, 'sloth_studio_*.png');
  const images = glob.sync(pattern);
  if (images.length === 0) {
    throw new Error(`No sloth images found matching ${pattern}`);
  }
  const picked = images[Math.floor(Math.random() * images.length)];
  return picked;
}

/**
 * @param {object} args
 * @param {string} [args.episodeTitle]
 * @param {string} [args.outputPath]     - final mp4 path; default remotion/out/short_<ts>.mp4
 * @param {string} [args.workDir]        - intermediate scratch dir
 * @param {string} [args.podcastScript]  - full podcast script from Airtable
 * @param {object} [args.selectedBeat]   - user-selected beat from previewTopics
 * @returns {Promise<{ outputPath: string, manifest: object }>}
 */
async function runShortsPipeline({
  episodeTitle = '',
  outputPath,
  workDir,
  podcastScript: externalScript,
  selectedBeat,
  coverHeadline,
  onStageChange,
  avatarFilename,
  segmentType,
}) {
  const reportStage = onStageChange || (() => {});

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  workDir = workDir || path.join(PROJECT_ROOT, 'temp', `shorts_${ts}`);
  outputPath = outputPath || path.join(REMOTION_DIR, 'out', `short_${ts}.mp4`);
  await fs.ensureDir(workDir);
  await fs.ensureDir(path.dirname(outputPath));

  // Use user-selected avatar or pick random
  const avatarImagePath = avatarFilename
    ? path.join(SLOTH_IMAGES_DIR, avatarFilename)
    : pickRandomSlothImage();
  console.log(`\n🦥 Avatar: ${path.basename(avatarImagePath)}`);

  const manifest = {
    startedAt: new Date().toISOString(),
    inputs: { avatarImagePath, episodeTitle },
    workDir,
    stages: {},
  };

  // Ground-truth podcast script from Airtable (if available).
  let podcastScript = externalScript || null;
  if (podcastScript) {
    console.log(`   [script] using externally provided podcast script (${podcastScript.length} chars)`);
  } else if (process.env.AIRTABLE_API_KEY) {
    try {
      const { AirtableService } = require('../airtable');
      const at = new AirtableService();
      const row = await at.getLatestPodcastScript();
      if (row?.script) {
        podcastScript = row.script;
        console.log(`   [airtable] fetched podcast_script (${row.date}, ${podcastScript.length} chars)`);
      } else {
        console.warn('   [airtable] no podcast_script row found');
      }
    } catch (err) {
      console.warn(`   [airtable] failed to fetch script: ${err.message}`);
    }
  }

  // ── Stage 1: Highlight extraction (narration script) ────────────────────
  reportStage('extractHighlight');
  console.log('\n━━━ Stage 1/7: Generate narration script ━━━');
  const plan = await extractHighlight({ episodeTitle, podcastScript, selectedBeat, segmentType });
  await fs.writeJSON(path.join(workDir, '01_plan.json'), plan, { spaces: 2 });
  manifest.stages.highlight = { stub: !!plan._stub, ...plan };
  console.log(`   hook: ${plan.hook_script}`);
  console.log(`   narration: ${plan.narration_script.slice(0, 80)}...`);
  console.log(`   outro: ${plan.outro_script}`);

  // ── Stage 2: VoAI TTS — synthesize all three segments ──────────────────
  reportStage('tts');
  console.log('\n━━━ Stage 2/7: VoAI TTS (hook + narration + outro) ━━━');
  const hookAudioPath = path.join(workDir, '02_hook.m4a');
  const narrationAudioPath = path.join(workDir, '02_narration.m4a');
  const outroAudioPath = path.join(workDir, '02_outro.m4a');
  const hook = await synthesize({ text: plan.hook_script, outPath: hookAudioPath });
  const narration = await synthesize({ text: plan.narration_script, outPath: narrationAudioPath });
  const outro = await synthesize({ text: plan.outro_script, outPath: outroAudioPath });
  manifest.stages.voai = { hook, narration, outro };
  console.log(`   hook: ${hook.durationSec.toFixed(1)}s | narration: ${narration.durationSec.toFixed(1)}s | outro: ${outro.durationSec.toFixed(1)}s`);

  // ── Stage 3: Whisper on TTS audio for word-level caption timestamps ────
  reportStage('whisper');
  console.log('\n━━━ Stage 3/7: Whisper on TTS for caption sync ━━━');
  const [hookTranscription, narrationTranscription, outroTranscription] = await Promise.all([
    transcribe(hook.path).catch(err => { console.warn(`   [caption-sync] hook transcription failed: ${err.message}`); return null; }),
    transcribe(narration.path).catch(err => { console.warn(`   [caption-sync] narration transcription failed: ${err.message}`); return null; }),
    transcribe(outro.path).catch(err => { console.warn(`   [caption-sync] outro transcription failed: ${err.message}`); return null; }),
  ]);
  if (hookTranscription) console.log(`   hook: ${hookTranscription.words.length} words`);
  if (narrationTranscription) console.log(`   narration: ${narrationTranscription.words.length} words`);
  if (outroTranscription) console.log(`   outro: ${outroTranscription.words.length} words`);

  // ── Stage 4: Sloth videos (Kling 2.6 I2V) ─────────────────────────────
  // Generate 2 x 10s clips in parallel: hook (talking) + outro (CTA)
  reportStage('slothVideo');
  console.log('\n━━━ Stage 4/7: Sloth videos (Kling 2.6) ━━━');
  const slothHookVideoPath = path.join(workDir, '04_sloth_hook.mp4');
  const slothOutroVideoPath = path.join(workDir, '04_sloth_outro.mp4');
  try {
    console.log('   generating 2 clips in parallel (hook + outro)...');
    await Promise.all([
      generateSlothVideo({ outPath: slothHookVideoPath, avatarImagePath, prompt: SLOTH_HOOK_PROMPT }),
      generateSlothVideo({ outPath: slothOutroVideoPath, avatarImagePath, prompt: SLOTH_OUTRO_PROMPT }),
    ]);
    console.log(`   ✅ hook:  ${path.basename(slothHookVideoPath)}`);
    console.log(`   ✅ outro: ${path.basename(slothOutroVideoPath)}`);
    manifest.stages.slothVideo = { hookPath: slothHookVideoPath, outroPath: slothOutroVideoPath, avatar: path.basename(avatarImagePath) };
  } catch (err) {
    console.error(`   [sloth-kling] failed: ${err.message}`);
    throw err;
  }

  // ── Stage 5: B-roll (Pexels + optional kie.ai Veo hero clip) ──────────
  reportStage('broll');
  console.log('\n━━━ Stage 5/7: B-roll ━━━');
  const brollDir = path.join(workDir, 'broll');
  const pexelsResults = await fetchBrollAll(plan.broll_keywords, brollDir);

  let brollResults = pexelsResults;
  if (process.env.ENABLE_KIE_HERO_BROLL === 'true' && plan.broll_keywords.length > 0) {
    try {
      const heroPath = path.join(brollDir, 'hero_veo.mp4');
      const heroKeyword = plan.broll_keywords[0];
      const hero = await generateHeroBroll({ keyword: heroKeyword, outPath: heroPath });
      brollResults = [hero, ...pexelsResults];
      console.log(`   [broll] Veo hero clip prepended — ${brollResults.length} clips total`);
    } catch (err) {
      console.warn(`   [broll] Veo hero generation failed, falling back to Pexels only: ${err.message}`);
    }
  }
  manifest.stages.broll = brollResults;

  // ── Stage 6: Concat master audio: hook → narration → outro ─────────────
  reportStage('concatAudio');
  console.log('\n━━━ Stage 6/7: Concat master audio ━━━');
  const masterAudioPath = path.join(workDir, '06_master.m4a');
  await concatAudio([hook.path, narration.path, outro.path], masterAudioPath);
  const masterDuration = await getDuration(masterAudioPath);
  console.log(`   master audio: ${masterDuration.toFixed(1)}s`);
  manifest.stages.masterAudio = { path: masterAudioPath, durationSec: masterDuration };

  // ── Stage 7: Stage assets + build Remotion props + render ──────────────
  reportStage('render');
  console.log('\n━━━ Stage 7/7: Stage assets + build Remotion props + render ━━━');
  const stageDir = path.join(REMOTION_DIR, 'public', `run_${ts}`);
  await fs.ensureDir(stageDir);
  const stagedAudio = await stageAsset(masterAudioPath, stageDir, 'master.m4a');
  const stagedAvatar = await stageAsset(avatarImagePath, stageDir, 'avatar' + path.extname(avatarImagePath));

  // Stage sloth videos — hook video for opening + interstitials, outro video for CTA ending
  const stagedSlothHook = await stageAsset(slothHookVideoPath, stageDir, 'sloth_hook.mp4');
  const stagedSlothOutro = await stageAsset(slothOutroVideoPath, stageDir, 'sloth_outro.mp4');
  const slothHookSrc = rel(stagedSlothHook);
  const slothOutroSrc = rel(stagedSlothOutro);

  // Distribute B-roll across the narration segment, interleaving sloth
  const SLOTH_INTERLEAVE_EVERY = 2; // every 2 B-roll clips (same video, don't overuse)
  const SLOTH_SLOT_SEC = 3.5;

  const narrationDuration = narration.durationSec;
  const narrationSegmentStart = hook.durationSec;
  const stagedBroll = [];
  const slothClipSlots = [];

  if (brollResults.length > 0 && narrationDuration > 0) {
    const numBroll = brollResults.length;
    const numSlothSlots = (numBroll > 2 && narrationDuration >= 15)
      ? Math.floor((numBroll - 1) / SLOTH_INTERLEAVE_EVERY)
      : 0;
    const totalSlothTime = numSlothSlots * SLOTH_SLOT_SEC;
    const brollTime = narrationDuration - totalSlothTime;
    const brollSlotDur = brollTime / numBroll;

    let cursor = narrationSegmentStart;
    for (let i = 0; i < numBroll; i++) {
      const dest = await stageAsset(brollResults[i].path, stageDir, `broll_${i}.mp4`);
      stagedBroll.push({
        src: rel(dest),
        start: cursor,
        end: cursor + brollSlotDur,
      });
      cursor += brollSlotDur;

      if (numSlothSlots > 0 && (i + 1) % SLOTH_INTERLEAVE_EVERY === 0 && i < numBroll - 1) {
        slothClipSlots.push({ start: cursor, end: cursor + SLOTH_SLOT_SEC });
        cursor += SLOTH_SLOT_SEC;
      }
    }
    if (slothClipSlots.length > 0) {
      console.log(`   interleaved ${slothClipSlots.length} sloth reaction shot(s) among ${numBroll} B-roll clips`);
    }
  }

  const captions = buildCaptionsFromPlan({
    plan,
    hookDuration: hook.durationSec,
    narrationDuration: narration.durationSec,
    outroDuration: outro.durationSec,
    hookTranscription,
    narrationTranscription,
    outroTranscription,
  });

  const props = {
    audioSrc: rel(stagedAudio),
    avatarImageSrc: rel(stagedAvatar),
    headline: plan.headline,
    captions,
    totalDurationSec: masterDuration,
    slothHookVideoSrc: slothHookSrc,
    slothOutroVideoSrc: slothOutroSrc,
    hookDurationSec: hook.durationSec,
    outroDurationSec: outro.durationSec,
    brollClips: stagedBroll,
    slothClipSlots,
    slothClipVideoSrc: slothClipSlots.length > 0 ? slothHookSrc : undefined,
  };
  const propsPath = path.join(workDir, '07_props.json');
  await fs.writeJSON(propsPath, props, { spaces: 2 });

  // Render with Remotion
  console.log('\n   Rendering with Remotion...');
  let coverPath = null;
  try {
    await renderRemotion({ propsPath, outputPath });

    // Render Reels cover image if headline provided
    if (coverHeadline) {
      console.log('\n   Rendering Reels cover image...');
      coverPath = path.join(path.dirname(outputPath), `cover_${ts}.png`);
      const coverProps = {
        headline: coverHeadline,
        backgroundImageSrc: rel(stagedAvatar),
      };
      const coverPropsPath = path.join(workDir, '08_cover_props.json');
      await fs.writeJSON(coverPropsPath, coverProps, { spaces: 2 });
      await renderRemotionStill({ propsPath: coverPropsPath, outputPath: coverPath });
      console.log(`   ✅ Cover: ${coverPath}`);
      manifest.stages.cover = { coverPath, headline: coverHeadline };
    }
  } finally {
    await fs.remove(stageDir).catch(() => {});
  }
  manifest.stages.render = { outputPath };
  manifest.finishedAt = new Date().toISOString();

  await fs.writeJSON(path.join(workDir, '99_manifest.json'), manifest, { spaces: 2 });
  console.log(`\n✅ Done. Output: ${outputPath}`);
  if (coverPath) console.log(`   Cover: ${coverPath}`);
  return { outputPath, coverPath, manifest };
}

/**
 * Build captions from the all-TTS plan. Three segments: hook, narration, outro.
 * Each uses Whisper word-level timestamps from the TTS audio for accurate sync.
 */
function buildCaptionsFromPlan({ plan, hookDuration, narrationDuration, outroDuration, hookTranscription, narrationTranscription, outroTranscription }) {
  const captions = [];

  // 1. Hook caption
  if (hookTranscription && hookTranscription.words && hookTranscription.words.length > 0) {
    pushWhisperCaptions(captions, plan.hook_script, hookTranscription.words, 0);
  } else {
    pushFabricatedCaptions(captions, plan.hook_script, 0, hookDuration);
  }
  let cursor = hookDuration;

  // 2. Narration caption
  if (narrationTranscription && narrationTranscription.words && narrationTranscription.words.length > 0) {
    pushWhisperCaptions(captions, plan.narration_script, narrationTranscription.words, cursor);
  } else {
    pushFabricatedCaptions(captions, plan.narration_script, cursor, cursor + narrationDuration);
  }
  cursor += narrationDuration;

  // 3. Outro caption
  if (outroTranscription && outroTranscription.words && outroTranscription.words.length > 0) {
    pushWhisperCaptions(captions, plan.outro_script, outroTranscription.words, cursor);
  } else {
    pushFabricatedCaptions(captions, plan.outro_script, cursor, cursor + outroDuration);
  }

  return captions;
}

/**
 * Build a caption with fabricated even-spaced word timings.
 * Tokenizes into atomic units:
 *   - ASCII word/number runs stay whole ("Code", "AI", "ChatGPT", "2025")
 *   - CJK is grouped into 2-char beats
 *   - Punctuation stays as single-char tokens
 */
const CAPTION_TOKEN_RE = /[A-Za-z0-9]+(?:[''][A-Za-z0-9]+)?|[\u4e00-\u9fff]{1,2}|[^\s]/g;

function makeFabricatedCaption(text, startSec, endSec) {
  const cleaned = (text || '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const tokens = cleaned.match(CAPTION_TOKEN_RE) || [];
  if (tokens.length === 0) return null;
  const span = Math.max(0.05, endSec - startSec);
  const each = span / tokens.length;
  const words = tokens.map((tok, i) => ({
    word: tok,
    start: startSec + i * each,
    end: startSec + (i + 1) * each,
  }));
  return { text: cleaned, start: startSec, end: endSec, words };
}

/**
 * Visible-length-aware phrase chunker that never splits English words.
 */
const CAPTION_BREAK_RE = /([，。！？、；：,.!?;:])/;
const CAPTION_CHUNK_MAX = 20;

function splitIntoCaptionChunks(cleaned) {
  if (!cleaned) return [];
  const rawParts = cleaned.split(CAPTION_BREAK_RE).filter(Boolean);
  const segments = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i];
    if (CAPTION_BREAK_RE.test(part) && segments.length > 0) {
      segments[segments.length - 1] += part;
    } else if (part) {
      segments.push(part);
    }
  }
  if (segments.length === 0) segments.push(cleaned);

  const expanded = [];
  for (const seg of segments) {
    if (seg.length <= CAPTION_CHUNK_MAX) {
      expanded.push(seg);
      continue;
    }
    const toks = seg.match(CAPTION_TOKEN_RE) || [seg];
    let buf = '';
    for (const t of toks) {
      if (buf.length + t.length > CAPTION_CHUNK_MAX && buf) {
        expanded.push(buf);
        buf = t;
      } else {
        buf += t;
      }
    }
    if (buf) expanded.push(buf);
  }

  const chunks = [];
  let buf = '';
  for (const seg of expanded) {
    if (!buf) {
      buf = seg;
    } else if (buf.length + seg.length <= CAPTION_CHUNK_MAX) {
      buf += seg;
    } else {
      chunks.push(buf);
      buf = seg;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function pushFabricatedCaptions(captions, text, t0, t1) {
  const cleaned = (text || '').replace(/\s+/g, '');
  if (!cleaned) return;
  const chunks = splitIntoCaptionChunks(cleaned);
  if (chunks.length === 0) return;
  const totalLen = chunks.reduce((n, c) => n + c.length, 0) || 1;
  const span = Math.max(0.05, t1 - t0);
  let acc = t0;
  chunks.forEach((c, i) => {
    const share = i === chunks.length - 1
      ? t1 - acc
      : (span * c.length) / totalLen;
    const start = acc;
    const end = Math.min(t1, acc + share);
    acc = end;
    const cap = makeFabricatedCaption(c, start, end);
    if (cap) captions.push(cap);
  });
}

/**
 * Map a text string onto an array of word timing slots proportionally by
 * character count, then fix splits that land in the middle of English words.
 */

/**
 * Group mapped word objects into display chunks (≤ CAPTION_CHUNK_MAX chars)
 * and push them as captions with real timings.
 */
function buildCaptionsFromMappedWords(captions, mappedWords) {
  const chunks = groupWordsIntoChunks(mappedWords, CAPTION_CHUNK_MAX);
  for (const chunk of chunks) {
    const tokens = chunk.text.match(CAPTION_TOKEN_RE) || [];
    if (tokens.length === 0) continue;
    const totalLen = tokens.reduce((n, t) => n + t.length, 0) || 1;
    const span = chunk.end - chunk.start;
    let acc = chunk.start;
    const words = tokens.map((tok, j) => {
      const share = j === tokens.length - 1
        ? chunk.end - acc
        : (span * tok.length) / totalLen;
      const w = { word: tok, start: acc, end: acc + share };
      acc += share;
      return w;
    });
    captions.push({ text: chunk.text, start: chunk.start, end: chunk.end, words });
  }
}

/**
 * Greedy-pack mapped word objects into display chunks ≤ maxLen chars,
 * preferring to break at punctuation so captions feel natural.
 */
const PUNCT_RE = /[，。！？、；：,.!?;:」）]/;
const PUNCT_BREAK_RE = /[，。！？、；：,.!?;:」）]$/;

function groupWordsIntoChunks(mappedWords, maxLen) {
  const chunks = [];
  let buf = null;
  for (let i = 0; i < mappedWords.length; i++) {
    const w = mappedWords[i];
    const isPunct = PUNCT_RE.test(w.text) && w.text.length <= 2;

    if (!buf) {
      // Don't start a new chunk with lone punctuation — attach to previous chunk
      if (isPunct && chunks.length > 0) {
        chunks[chunks.length - 1].text += w.text;
        chunks[chunks.length - 1].end = w.end;
      } else {
        buf = { text: w.text, start: w.start, end: w.end };
      }
    } else if (buf.text.length + w.text.length <= maxLen) {
      buf.text += w.text;
      buf.end = w.end;
      if (PUNCT_BREAK_RE.test(buf.text) && buf.text.length >= 4) {
        chunks.push(buf);
        buf = null;
      }
    } else {
      // About to overflow — absorb punctuation even if it exceeds maxLen
      if (isPunct) {
        buf.text += w.text;
        buf.end = w.end;
        chunks.push(buf);
        buf = null;
      } else {
        // Don't split English words across chunks: if buf ends with ASCII
        // and w starts with ASCII, they're the same word — keep together
        const ASCII_TRAIL = /[A-Za-z0-9]$/;
        const ASCII_LEAD = /^[A-Za-z0-9]/;
        if (ASCII_TRAIL.test(buf.text) && ASCII_LEAD.test(w.text)) {
          buf.text += w.text;
          buf.end = w.end;
        } else {
          chunks.push(buf);
          buf = { text: w.text, start: w.start, end: w.end };
        }
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Build captions using the ORIGINAL script text (accurate) with Whisper's
 * overall time range (accurate timing). Whisper's individual word text is
 * discarded because it often contains homophone errors and English casing issues.
 */
function pushWhisperCaptions(captions, scriptText, whisperWords, offset) {
  if (!whisperWords || whisperWords.length === 0) return;

  const t0 = whisperWords[0].start + offset;
  const t1 = whisperWords[whisperWords.length - 1].end + offset;

  // Use original script text with Whisper's time range
  pushFabricatedCaptions(captions, scriptText, t0, t1);
}

/**
 * Copy a source file into the staging dir, returning the destination path.
 */
async function stageAsset(srcPath, stageDir, destName) {
  const dest = path.join(stageDir, destName);
  await fs.copy(srcPath, dest);
  return dest;
}

/**
 * Convert an absolute path inside remotion/public/ into a forward-slash relative
 * path so staticFile() in the composition can serve it via Remotion's HTTP layer.
 */
function rel(absPath) {
  const publicDir = path.join(REMOTION_DIR, 'public');
  return path.relative(publicDir, absPath).split(path.sep).join('/');
}

async function renderRemotionStill({ propsPath, outputPath }) {
  const propsArg = `--props=${propsPath}`;
  const cmd =
    `cd "${REMOTION_DIR}" && npx remotion still src/index.ts ReelsCover ` +
    `"${outputPath}" ${propsArg}`;
  console.log(`   $ ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

async function renderRemotion({ propsPath, outputPath }) {
  const propsArg = `--props=${propsPath}`;
  const cmd =
    `cd "${REMOTION_DIR}" && npx remotion render src/index.ts ShortVideo ` +
    `"${outputPath}" ${propsArg}`;
  console.log(`   $ ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

/**
 * Preview phase: extract essence beats for user review.
 * Returns 3-5 candidate topics so the user can choose which one to make a short from.
 */
async function previewTopics({ podcastScript, episodeTitle = '' }) {
  console.log('\n━━━ Preview: Extract essence beats ━━━');

  const { OpenRouterService } = require('../openRouterService');
  const openRouter = new OpenRouterService();
  const { extractEssence } = require('./highlightExtractor');
  const beats = await extractEssence({ podcastScript: podcastScript || null, episodeTitle, openRouter });

  console.log(`\n📋 ${beats.length} candidate topic(s):`);
  beats.forEach((b, i) => {
    console.log(`  [${i + 1}] ${b.text.slice(0, 60)}...`);
    if (b.reason) console.log(`      → ${b.reason}`);
  });

  return { beats, episodeTitle };
}

module.exports = {
  runShortsPipeline,
  previewTopics,
  pickRandomSlothImage,
  renderRemotionStill,
  stageAsset,
  rel,
  REMOTION_DIR,
};
