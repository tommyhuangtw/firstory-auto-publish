import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Word = {
  word: string;
  start: number; // absolute seconds on master timeline
  end: number;
};

type Props = {
  text: string;
  /**
   * Optional per-word timings for CapCut-style active-word highlight.
   * When provided, each word is rendered as an inline span and the word
   * currently being spoken is visually emphasised.
   */
  words?: Word[];
  /**
   * Absolute master-timeline start of this caption (seconds). Needed so we
   * can compare `words[i].start` (also absolute) to the current playhead.
   * The parent Sequence rewinds `frame` to 0 at the caption's start.
   */
  captionStart?: number;
};

/**
 * Bottom-third caption with a spring "pop in" entrance animation.
 *
 * When `words` is provided, each word is a separate span: the active word
 * (the one currently being spoken) is highlighted in yellow with a slight
 * scale-up; already-spoken words stay in white; upcoming words are dimmed.
 * Falls back to the old single-block render when `words` is undefined.
 */
export const AnimatedCaption: React.FC<Props> = ({ text, words, captionStart = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entry animation (shared by both modes)
  const enter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 200 },
  });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const translateY = interpolate(enter, [0, 1], [40, 0]);

  // Absolute playhead time (seconds) on the master timeline
  const absNow = captionStart + frame / fps;

  const containerStyle: React.CSSProperties = {
    opacity,
    transform: `translateY(${translateY}px)`,
    background: 'rgba(0, 0, 0, 0.78)',
    color: 'white',
    padding: '32px 48px',
    borderRadius: 32,
    fontSize: 72,
    fontWeight: 800,
    textAlign: 'center',
    fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
    lineHeight: 1.25,
    maxWidth: 920,
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
    textShadow: '0 2px 12px rgba(0,0,0,0.8)',
  };

  const wrapperStyle: React.CSSProperties = {
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 280,
    paddingLeft: 80,
    paddingRight: 80,
  };

  // ── Fallback: no word timings → single text block ──────────────────────
  if (!words || words.length === 0) {
    return (
      <AbsoluteFill style={wrapperStyle}>
        <div style={containerStyle}>{text}</div>
      </AbsoluteFill>
    );
  }

  // ── Word-level highlight mode ──────────────────────────────────────────
  return (
    <AbsoluteFill style={wrapperStyle}>
      <div style={containerStyle}>
        {words.map((w, i) => {
          const isActive = absNow >= w.start && absNow < w.end;
          const isPast = absNow >= w.end;
          // Short pop spring when the word becomes active
          const activeSpring = isActive
            ? spring({
                frame: Math.max(0, frame - Math.round((w.start - captionStart) * fps)),
                fps,
                config: { damping: 10, stiffness: 260 },
                durationInFrames: 8,
              })
            : 0;
          const activeScale = 1 + activeSpring * 0.12;
          const color = isActive
            ? '#ffd93d' // accent yellow
            : isPast
              ? '#ffffff'
              : 'rgba(255,255,255,0.55)';
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                color,
                transform: `scale(${activeScale})`,
                transition: 'color 80ms linear',
                marginRight: 2,
                textShadow: isActive
                  ? '0 4px 18px rgba(255, 215, 0, 0.55), 0 2px 12px rgba(0,0,0,0.8)'
                  : '0 2px 12px rgba(0,0,0,0.8)',
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
