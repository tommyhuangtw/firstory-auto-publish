import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type BRollClip = {
  src: string;
  start: number; // seconds on the master timeline
  end: number;
};

type Props = {
  clips: BRollClip[];
};

const resolveSrc = (src: string): string => {
  if (/^(https?:|file:|data:)/.test(src)) return src;
  return staticFile(src);
};

/**
 * One B-roll clip with a **very subtle** center-anchored zoom and no horizontal
 * pan. User feedback: the previous Ken Burns pan read as camera shake on phone
 * screens. This keeps a hint of life (2–6% zoom per clip) without wobbling.
 */
const BRollItem: React.FC<{ src: string; durationSec: number }> = ({ src, durationSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, t / Math.max(0.1, durationSec)));
  const zoom = 1.02 + progress * 0.04; // 1.02 → 1.06, gentle and steady
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={resolveSrc(src)}
        muted
        playbackRate={1}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      />
      {/* Dark gradient overlay so captions + foreground elements remain readable */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.25) 70%, rgba(0,0,0,0.7) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Renders a sequence of B-roll clips back-to-back on the master timeline.
 * Each clip's `start` / `end` is in seconds relative to the whole composition.
 * Absent or empty → renders nothing (composition falls back to blurred cover).
 */
export const BRollLayer: React.FC<Props> = ({ clips }) => {
  const { fps } = useVideoConfig();
  if (!clips || clips.length === 0) return null;
  return (
    <AbsoluteFill>
      {clips.map((clip, i) => {
        const startFrame = Math.round(clip.start * fps);
        const durationSec = Math.max(0.1, clip.end - clip.start);
        const durationFrames = Math.max(1, Math.round(durationSec * fps));
        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <BRollItem src={clip.src} durationSec={durationSec} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
