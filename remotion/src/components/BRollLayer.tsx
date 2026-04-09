import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
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
 * One B-roll clip wrapped in a Ken Burns zoom + subtle darken overlay so the
 * center foreground (cover or sloth) and bottom captions stay legible.
 */
const BRollItem: React.FC<{ src: string; durationSec: number }> = ({ src, durationSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, t / Math.max(0.1, durationSec)));
  const zoom = 1.05 + progress * 0.1; // 1.05 → 1.15
  const panX = interpolate(progress, [0, 1], [-2, 2]); // %
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={resolveSrc(src)}
        muted
        playbackRate={1}
        style={{
          width: '110%',
          height: '110%',
          objectFit: 'cover',
          transform: `scale(${zoom}) translate(${panX}%, 0)`,
          marginLeft: '-5%',
          marginTop: '-5%',
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
