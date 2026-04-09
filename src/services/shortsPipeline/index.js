/**
 * shortsPipeline/index.js — orchestration for the 40–60s podcast highlight pipeline.
 *
 * Phases (each stage gracefully degrades to a stub when its API key is absent):
 *   1. transcribe        — OpenAI Whisper → transcript with word timestamps
 *   2. extractHighlight  — Gemini picks the best 40–60s + writes hook/outro scripts
 *   3. cutClips          — FFmpeg slices the original audio
 *   4. ttsHookOutro      — VoAI synthesises hook + outro narration
 *   5. animateAvatar     — Hedra Character-3 lip-syncs the sloth image to (4)
 *   6. fetchBroll        — Pexels downloads B-roll matching keywords
 *   7. concatMasterAudio — hook(VoAI) → clip(s) → outro(VoAI), one master track
 *   8. buildRemotionProps — assemble props.json for the Remotion composition
 *   9. renderRemotion     — call `remotion render` to produce the final 9:16 MP4
 *
 * Returns the final output path + a manifest describing every intermediate.
 */

const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const { transcribe } = require('./transcribe');
const { extractHighlight } = require('./highlightExtractor');
const { extractClips, concatAudio, getDuration } = require('./audioCutter');
const { synthesize } = require('./voai');
const { animate } = require('./hedra');
const { fetchAll: fetchBrollAll } = require('./pexels');

const execAsync = promisify(exec);

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const REMOTION_DIR = path.join(PROJECT_ROOT, 'remotion');

/**
 * @param {object} args
 * @param {string} args.audioPath        - source podcast audio
 * @param {string} args.avatarImagePath  - sloth/character image
 * @param {string} [args.episodeTitle]
 * @param {string} [args.outputPath]     - final mp4 path; default remotion/out/short_<ts>.mp4
 * @param {string} [args.workDir]        - intermediate scratch dir
 * @returns {Promise<{ outputPath: string, manifest: object }>}
 */
async function runShortsPipeline({
  audioPath,
  avatarImagePath,
  episodeTitle = '',
  outputPath,
  workDir,
}) {
  if (!fs.existsSync(audioPath)) throw new Error(`audio not found: ${audioPath}`);
  if (!fs.existsSync(avatarImagePath)) throw new Error(`avatar image not found: ${avatarImagePath}`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  workDir = workDir || path.join(PROJECT_ROOT, 'temp', `shorts_${ts}`);
  outputPath = outputPath || path.join(REMOTION_DIR, 'out', `short_${ts}.mp4`);
  await fs.ensureDir(workDir);
  await fs.ensureDir(path.dirname(outputPath));

  const manifest = {
    startedAt: new Date().toISOString(),
    inputs: { audioPath, avatarImagePath, episodeTitle },
    workDir,
    stages: {},
  };

  // ── Stage 1: Transcribe ──────────────────────────────────────────────────
  console.log('\n━━━ Stage 1/9: Transcribe ━━━');
  const transcription = await transcribe(audioPath);
  await fs.writeJSON(path.join(workDir, '01_transcript.json'), transcription, { spaces: 2 });
  manifest.stages.transcribe = {
    stub: !!transcription._stub,
    durationSec: transcription.duration,
    segmentCount: transcription.segments.length,
    wordCount: transcription.words.length,
  };
  console.log(`   transcript: ${transcription.segments.length} segments, ${transcription.duration.toFixed(1)}s`);

  // ── Stage 2: Highlight extraction ────────────────────────────────────────
  console.log('\n━━━ Stage 2/9: Highlight extraction ━━━');
  const plan = await extractHighlight({ transcription, episodeTitle });
  await fs.writeJSON(path.join(workDir, '02_plan.json'), plan, { spaces: 2 });
  manifest.stages.highlight = { stub: !!plan._stub, ...plan };
  console.log(`   hook: ${plan.hook_script}`);
  console.log(`   clips: ${plan.clips.map(c => `${c.start.toFixed(1)}–${c.end.toFixed(1)}`).join(', ')}`);
  console.log(`   outro: ${plan.outro_script}`);

  // ── Stage 3: Cut original-audio clips ────────────────────────────────────
  console.log('\n━━━ Stage 3/9: Cut original audio clips ━━━');
  const clipPaths = await extractClips(audioPath, plan.clips, path.join(workDir, 'clips'));
  manifest.stages.cutClips = { paths: clipPaths };

  // ── Stage 4: VoAI hook + outro ───────────────────────────────────────────
  console.log('\n━━━ Stage 4/9: VoAI hook + outro ━━━');
  const hookAudioPath = path.join(workDir, '04_hook.m4a');
  const outroAudioPath = path.join(workDir, '04_outro.m4a');
  const hook = await synthesize({ text: plan.hook_script, outPath: hookAudioPath });
  const outro = await synthesize({ text: plan.outro_script, outPath: outroAudioPath });
  manifest.stages.voai = { hook, outro };

  // ── Stage 5: Hedra avatar animation ──────────────────────────────────────
  console.log('\n━━━ Stage 5/9: Hedra avatar animation (hook + outro) ━━━');
  const slothHookVid = path.join(workDir, '05_sloth_hook.mp4');
  const slothOutroVid = path.join(workDir, '05_sloth_outro.mp4');
  await animate({ imagePath: avatarImagePath, audioPath: hook.path, outPath: slothHookVid });
  await animate({ imagePath: avatarImagePath, audioPath: outro.path, outPath: slothOutroVid });
  manifest.stages.hedra = { hookVideo: slothHookVid, outroVideo: slothOutroVid };

  // ── Stage 6: Pexels B-roll ───────────────────────────────────────────────
  console.log('\n━━━ Stage 6/9: Pexels B-roll ━━━');
  const brollResults = await fetchBrollAll(plan.broll_keywords, path.join(workDir, 'broll'));
  manifest.stages.broll = brollResults;

  // ── Stage 7: Concat master audio: hook → clips → outro ───────────────────
  console.log('\n━━━ Stage 7/9: Concat master audio ━━━');
  const masterAudioPath = path.join(workDir, '07_master.m4a');
  await concatAudio([hook.path, ...clipPaths, outro.path], masterAudioPath);
  const masterDuration = await getDuration(masterAudioPath);
  console.log(`   master audio: ${masterDuration.toFixed(1)}s`);
  manifest.stages.masterAudio = { path: masterAudioPath, durationSec: masterDuration };

  // ── Stage 8: Build Remotion props (stage assets into a temp public dir) ──
  console.log('\n━━━ Stage 8/9: Stage assets + build Remotion props ━━━');
  // Remotion serves assets via its dev HTTP server, so absolute file paths
  // outside its --public-dir return 404. We copy every referenced file into a
  // run-scoped staging dir and pass relative names that resolve via staticFile().
  const stageDir = path.join(REMOTION_DIR, 'public', `run_${ts}`);
  await fs.ensureDir(stageDir);
  const stagedAudio = await stageAsset(masterAudioPath, stageDir, 'master.m4a');
  const stagedAvatar = await stageAsset(avatarImagePath, stageDir, 'avatar' + path.extname(avatarImagePath));
  const stagedSlothHook = await stageAsset(slothHookVid, stageDir, 'sloth_hook.mp4');
  const stagedSlothOutro = await stageAsset(slothOutroVid, stageDir, 'sloth_outro.mp4');

  // Distribute B-roll clips evenly across the clip segment of the master timeline.
  // The master audio is [hook | clips | outro]; B-roll plays behind the clips
  // segment only (hook/outro have the sloth overlay as hero).
  const clipDurations = await Promise.all(clipPaths.map(getDuration));
  const clipSegmentStart = hook.durationSec;
  const clipSegmentDuration = clipDurations.reduce((a, b) => a + b, 0);
  const stagedBroll = [];
  if (brollResults.length > 0 && clipSegmentDuration > 0) {
    const slotDur = clipSegmentDuration / brollResults.length;
    for (let i = 0; i < brollResults.length; i++) {
      const dest = await stageAsset(brollResults[i].path, stageDir, `broll_${i}.mp4`);
      stagedBroll.push({
        src: rel(dest),
        start: clipSegmentStart + i * slotDur,
        end: clipSegmentStart + (i + 1) * slotDur,
      });
    }
  }

  const captions = buildCaptionsFromPlan({
    plan,
    transcription,
    hookDuration: hook.durationSec,
    clipDurations,
    outroDuration: outro.durationSec,
  });
  // Paths in props are RELATIVE to remotion/public/ so staticFile() can resolve them
  const props = {
    audioSrc: rel(stagedAudio),
    avatarImageSrc: rel(stagedAvatar),
    headline: plan.headline,
    captions,
    totalDurationSec: masterDuration,
    slothHookVideoSrc: rel(stagedSlothHook),
    slothOutroVideoSrc: rel(stagedSlothOutro),
    hookDurationSec: hook.durationSec,
    outroDurationSec: outro.durationSec,
    brollClips: stagedBroll,
  };
  const propsPath = path.join(workDir, '08_props.json');
  await fs.writeJSON(propsPath, props, { spaces: 2 });

  // ── Stage 9: Render with Remotion ────────────────────────────────────────
  console.log('\n━━━ Stage 9/9: Render with Remotion ━━━');
  try {
    await renderRemotion({ propsPath, outputPath });
  } finally {
    // Clean up the staged copies (the originals live in workDir)
    await fs.remove(stageDir).catch(() => {});
  }
  manifest.stages.render = { outputPath };
  manifest.finishedAt = new Date().toISOString();

  await fs.writeJSON(path.join(workDir, '99_manifest.json'), manifest, { spaces: 2 });
  console.log(`\n✅ Done. Output: ${outputPath}`);
  return { outputPath, manifest };
}

/**
 * Map highlight plan + audio durations into a flat list of caption blocks
 * timed against the *master* audio (which is hook + clips + outro back-to-back).
 */
function buildCaptionsFromPlan({ plan, transcription, hookDuration, clipDurations, outroDuration }) {
  const captions = [];

  // 1. Hook caption: split the hook script into ~3-word chunks
  pushChunked(captions, plan.hook_script, 0, hookDuration);
  let cursor = hookDuration;

  // 2. Clip captions: pull from transcription.segments overlapping each clip
  plan.clips.forEach((clip, i) => {
    const clipDur = clipDurations[i];
    const clipStartInOriginal = clip.start;
    const clipEndInOriginal = clip.end;
    const overlapping = transcription.segments.filter(
      s => s.end > clipStartInOriginal && s.start < clipEndInOriginal
    );
    if (overlapping.length === 0) {
      pushChunked(captions, '...', cursor, cursor + clipDur);
    } else {
      overlapping.forEach(seg => {
        const localStart = Math.max(0, seg.start - clipStartInOriginal);
        const localEnd = Math.min(clipDur, seg.end - clipStartInOriginal);
        if (localEnd > localStart) {
          captions.push({
            text: seg.text.trim(),
            start: cursor + localStart,
            end: cursor + localEnd,
          });
        }
      });
    }
    cursor += clipDur;
  });

  // 3. Outro caption
  pushChunked(captions, plan.outro_script, cursor, cursor + outroDuration);

  return captions;
}

/**
 * Split a long string into ~12-char chunks, distribute evenly across [t0, t1].
 */
function pushChunked(captions, text, t0, t1) {
  const chunks = chunkChinese(text, 14);
  if (chunks.length === 0) return;
  const each = (t1 - t0) / chunks.length;
  chunks.forEach((c, i) => {
    captions.push({ text: c, start: t0 + i * each, end: t0 + (i + 1) * each });
  });
}

function chunkChinese(text, size) {
  const out = [];
  const cleaned = text.replace(/\s+/g, '');
  for (let i = 0; i < cleaned.length; i += size) out.push(cleaned.slice(i, i + size));
  return out;
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

async function renderRemotion({ propsPath, outputPath }) {
  const propsArg = `--props=${propsPath}`;
  // Using npx so this works whether or not Remotion is installed at the top level.
  const cmd =
    `cd "${REMOTION_DIR}" && npx remotion render src/index.ts ShortVideo ` +
    `"${outputPath}" ${propsArg}`;
  console.log(`   $ ${cmd}`);
  const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

module.exports = { runShortsPipeline };
