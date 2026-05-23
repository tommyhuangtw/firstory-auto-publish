import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { LLMService } from '@/services/llmService';

export async function POST(request: NextRequest) {
  try {
    const { count = 5 } = (await request.json().catch(() => ({}))) as { count?: number };
    const numStyles = Math.min(Math.max(count, 1), 30);

    const db = getDb();
    const existing = db.prepare('SELECT name, bg, text_style, layout FROM thumbnail_styles').all() as { name: string; bg: string; text_style: string; layout: string }[];
    let existingNames = existing.map(s => s.name);
    // Track full definitions so LLM knows what visual styles already exist
    let existingDefs = existing.map(s => ({ name: s.name, bg: s.bg, text: s.text_style, layout: s.layout }));

    const llm = new LLMService();

    // Batch into chunks of 10 for reliable LLM output
    const batchSize = 10;
    const batches = Math.ceil(numStyles / batchSize);
    const allInserted: Array<{ id: number; name: string; bg: string; text: string; layout: string }> = [];
    const now = new Date().toISOString();
    const insert = db.prepare(
      'INSERT INTO thumbnail_styles (name, bg, text_style, layout, is_enabled, source, generated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
    );

    for (let batch = 0; batch < batches; batch++) {
      const batchCount = Math.min(batchSize, numStyles - batch * batchSize);

      const result = await llm.call({
        stage: 'thumbnail_style_discovery',
        messages: [{
          role: 'user',
          content: `You are a YouTube thumbnail design strategist specializing in tech/AI content.
Generate ${batchCount} NEW thumbnail style definitions. Each must be unique and different from existing styles.

Each style is a JSON object with exactly these fields:
- name: kebab-case slug, 2-3 words (e.g. "neon-outline", "retro-vhs")
- bg: background description, 1-2 sentences
- text: text styling description, 1-2 sentences
- layout: spatial layout, 1 sentence

Design for HIGH CTR YouTube thumbnails:
- Maximum 2-3 visual elements total
- Title text dominates 40-60% of image
- Clean, uncluttered backgrounds
- Bold, readable at mobile thumbnail size
- High contrast between text and background

Consider trending YouTube styles:
- 3D text with dramatic shadows/depth
- Cinematic color grading (teal/orange, moody blues)
- Bold color blocking with neon accents
- Retro/VHS/glitch aesthetics
- Minimalist flat with oversized typography
- Duotone or tritone color treatments
- Glassmorphism / frosted glass panels
- Comic/manga inspired bold outlines
- Isometric/3D illustration backgrounds
- Holographic/iridescent gradients
- Polaroid / instant photo frame
- Chalkboard / hand-drawn sketch
- Neon sign on brick wall
- Blueprint / technical drawing
- Watercolor wash backgrounds
- Pop art / halftone dots
- Cyberpunk / synthwave
- Paper cutout / collage
- Sticker / badge collection
- Vintage poster / propaganda

EXISTING STYLES — each new style MUST be visually distinct from ALL of these (different background treatment, different text effect, different overall aesthetic):
${JSON.stringify(existingDefs, null, 1)}

Output ONLY a valid JSON array of ${batchCount} objects. No markdown fences, no explanation.`,
        }],
        options: {
          preferredModel: 'google/gemini-2.5-flash',
          maxTokens: 3000,
          temperature: 0.95,
        },
      });

      if (!result.success || !result.content) continue;

      // Parse JSON from response (strip markdown fences if present)
      let cleaned = result.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      let parsed: Array<{ name: string; bg: string; text: string; layout: string }>;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        continue; // skip this batch on parse failure
      }

      // Filter out duplicates and validate
      const valid = parsed.filter(s =>
        s.name && s.bg && s.text && s.layout &&
        !existingNames.includes(s.name)
      );

      for (const s of valid) {
        try {
          const info = insert.run(s.name, s.bg, s.text, s.layout, 'generated', now);
          allInserted.push({ id: Number(info.lastInsertRowid), name: s.name, bg: s.bg, text: s.text, layout: s.layout });
          existingNames.push(s.name); // prevent cross-batch duplicates
          existingDefs.push({ name: s.name, bg: s.bg, text: s.text, layout: s.layout });
        } catch {
          // name conflict — skip
        }
      }
    }

    return NextResponse.json({ styles: allInserted, generated: allInserted.length, requested: numStyles });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
