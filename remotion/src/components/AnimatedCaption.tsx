import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

type Props = {
  text: string;
};

/**
 * Bottom-third caption with a spring "pop in" animation.
 * Phase 1 keeps it sentence-level. Phase 2 will swap this for a word-level
 * highlighter using Whisper word timestamps.
 */
export const AnimatedCaption: React.FC<Props> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 200 },
  });

  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const translateY = interpolate(enter, [0, 1], [40, 0]);

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 280,
        paddingLeft: 80,
        paddingRight: 80,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          background: 'rgba(0, 0, 0, 0.75)',
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
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
