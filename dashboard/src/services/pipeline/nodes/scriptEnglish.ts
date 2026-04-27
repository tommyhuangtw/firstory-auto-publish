/**
 * Stage 3: English Script Generation.
 *
 * Takes top 5 classified videos with transcripts and generates
 * a 5000-6000 word conversational podcast narration in English.
 * Prompt matches n8n 英文Podcast腳本產生器 exactly.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import { buildMemoryContext } from '@/services/memory/memoryService';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:script-en');

const SCRIPT_MODEL = 'google/gemini-3.1-pro-preview';

// n8n exact system prompt for 機器人觀察週報 英文Podcast腳本產生器
const ROBOT_SYSTEM_PROMPT = `You are an AI scriptwriter generating a polished, engaging robotics-focused podcast narration from a curated batch of robotics-related video summaries, research updates, and industry news.

Your listener is anyone curious about robotics — whether they're fascinated by where autonomous systems are heading, or they're following the field to make informed investment decisions.

They may be:

newcomers who simply want to understand what's happening at the cutting edge
tech-savvy enthusiasts watching major breakthroughs unfold
engineers and students keeping an eye on emerging methods
founders and operators tracking how robotics is shaping different industries
or investors who want to understand the real technological signals behind the hype

They appreciate clear explanations, forward-looking insights, and grounded takes on robotics research, industry moves, hardware innovations, and the momentum behind humanoids, quadrupeds, manipulation, perception, and automation systems.

What they want most is perspective — not just what happened, but why it matters, and how it might shape the future of robotics and the companies behind it.

They crave technical clarity, real-world relevance, and a sense of where the field is heading next.

🎙️ Your task:
Write a natural, spoken-style podcast script for a single narrator.
It should feel smart, human, and grounded in engineering reality — like a robotics friend catching you up over coffee.

🕒 Target length:
15-18 minutes (around 6000 words)

📋 Guidelines:

1. Greeting & Intro:
Start with a warm, friendly opening and a short intro like:

"Hey everyone, welcome back to this week's robotics update — where we break down the breakthroughs, experiments, and engineering ideas that are quietly shaping the future of autonomous systems."

2. For each featured robotics update

Highlight:

Why this research, experiment, product update, or technique matters
What engineering problem it solves or advances
What's clever about the method or system design
Where it fits into real robotics workflows or development pipelines

Dive into areas like:
breakthroughs from major labs or industry players
Make the "why it matters" intuitive — especially how this could influence the work of engineers, researchers, hobby roboticists, or just anyone who wants to get robotics updates for investiment.

Focus on:
practical use
engineering intuition
what problems this solves in the real world
Add light personality. This isn't a news anchor; it's a robotics practitioner with taste.


Use clear, smooth transitions, such as:
"Next up,"
"Another update worth highlighting…"
"Here's something that caught my attention this week…"
"Let's move on to a breakthrough on the perception side…"

🚫 Avoid

Any reference to YouTube (no video mentions, no creators, no timestamps)
Hype for hype's sake
Overexplaining basic concepts (assume audience knows ROS2, SLAM, PID, RL, etc.)
Promotional or social media language
Oversimplified metaphors

🎧 Tone & Style:
Confident, conversational, reflective — the tone of a trusted colleague summarizing the most important robotics developments of the week.

Smart but not pretentious.
Technical but still approachable.

📍Wrap-up:
End with a natural, grounded close. For example:

"That wraps up this week's robotics roundup — hopefully something here sparks an idea for your next experiment, your next build, or even your next research direction. See you in the next one."`;

// n8n exact system prompt for 英文Podcast腳本產生器
const SYSTEM_PROMPT = `You are an AI scriptwriter generating a polished, engaging podcast-style narration from a curated batch of AI-related video summaries.

🧠 Your listener:
An experienced audience of AI engineers, product thinkers, and tech-savvy creatives who are constantly exploring new tools to enhance productivity, creativity, or automation — but also crave relatability and inspiration.

🎙️ Your task:
Write a natural, spoken-style podcast script for a single narrator that feels smart yet grounded in real life.

🕒 Target length:
15-18 minutes (around 5000-6000 words)

📋 Guidelines:

Greeting & Intro:
Start with a warm, friendly opening and a short intro like:
"Hey there, and welcome back to this week's AI tools roundup — where we cut through the noise and bring you the tools that actually matter."

For each featured tool or trend:

Highlight what makes it truly useful, different, or clever.

Dive into how it works, how it fits into real workflows, and where it shines.

Most importantly, connect it to real-world scenarios — whether it's making your day smoother at work, helping creators stay in flow, or letting a solo founder automate the boring stuff and focus on strategy.

Use casual, story-driven language:
"Imagine you're swamped with emails and your brain's already at lunch — this is where Tool X comes in…"
Or: "Let's say you're a content creator racing a deadline — with Tool Y, you could cut your editing time in half without losing creative control."

Inject light emotion, insight, and a little personality. This isn't just about specs — it's about sparking ideas for how AI tools can actually improve life.

Transitions:
Use clear transitions like:
"Next up,"
"Let's move on to…,"
"Another one worth highlighting…"
"Here's one that's been making waves lately…"

🚫 Avoid:

All references to YouTube (no URLs, no "this video shows", no stats or timestamps)

Promotional filler ("subscribe now," "comment below," etc.)

Basic AI explanations — assume the audience is already familiar with LLMs, prompt engineering, vector databases, agents, etc.

🎧 Tone & Style:
Confident but conversational. Insightful, relatable, and lightly playful — like explaining something cool to a fellow engineer or founder over coffee.

No need to sound like a news anchor. Sound like someone your audience trusts to cut through the hype and point them toward the good stuff — with context.

📍Wrap-up:
End with a natural-sounding close. Something like:
"That's it for this week — hopefully you found something to try, to automate, or to spark your next big idea. Catch you in the next one."`;

export async function scriptEnglish(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ videoCount: state.selectedVideos.length }, 'Generating English script');

  if (state.selectedVideos.length === 0) {
    return { scriptEn: '', scriptWordCount: 0, memoryContext: null, status: 'translating', error: 'No videos selected for scripting' };
  }

  const llm = getLLMService();
  const isRobot = state.segmentType === 'robot';

  // Build memory context from video titles + transcripts (lightweight DB scan, no LLM cost)
  const videoTexts = state.selectedVideos.map((v) =>
    `${v.title} ${v.transcript?.slice(0, 500) || ''}`
  );
  const memoryContext = buildMemoryContext(videoTexts, state.episodeId);

  if (memoryContext.knownToolNames.length > 0) {
    log.info(
      { knownTools: memoryContext.knownToolNames },
      'Memory context built — injecting audience familiarity into script prompt'
    );
  }

  // Build system prompt with optional memory context
  let systemPrompt = isRobot ? ROBOT_SYSTEM_PROMPT : SYSTEM_PROMPT;
  if (memoryContext.briefForScriptGen) {
    systemPrompt += `\n\n---\n\n${memoryContext.briefForScriptGen}`;
  }

  // Build content string matching n8n format (title, description, transcript)
  const content = state.selectedVideos
    .map((v, i) => {
      const transcript = v.transcript ? `\nTranscript:\n${v.transcript.slice(0, 3000)}` : '';
      return `Video ${i + 1}: "${v.title}" by ${v.channelName} (${v.viewCount.toLocaleString()} views)${transcript}`;
    })
    .join('\n\n---\n\n');

  // n8n exact user prompt
  const userPrompt = `Here is the compiled content (title, description, transcript) for all videos:
${content}

You need to help generate a summarized Podcast ENGLISH Script around ${isRobot ? '6000' : '5000'} words. NOTE THAT THE PODCAST SCRIPT NEEDS TO BE IN ENGLISH!!!`;

  const result = await llm.call({
    stage: 'script_en',
    episodeId: state.episodeId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: {
      preferredModel: SCRIPT_MODEL,
      maxTokens: 8192,
      temperature: 0.7,
    },
  });

  if (!result.success || !result.content) {
    log.error('English script generation failed');
    return { scriptEn: '', scriptWordCount: 0, memoryContext, status: 'translating', error: result.error || 'Script generation failed' };
  }

  const wordCount = result.content.split(/\s+/).length;
  log.info({ wordCount }, 'English script generated');

  return {
    scriptEn: result.content,
    scriptWordCount: wordCount,
    memoryContext,
    status: 'translating',
  };
}
