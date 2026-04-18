import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

export type ReelsCoverProps = {
  headline: string;
  backgroundImageSrc: string;
};

const resolveSrc = (src: string): string => {
  if (/^(https?:|file:|data:)/.test(src)) return src;
  return staticFile(src);
};

export const ReelsCover: React.FC<ReelsCoverProps> = ({
  headline,
  backgroundImageSrc,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#FFF9F0' }}>
      {/* Bright sloth background */}
      <Img
        src={resolveSrc(backgroundImageSrc)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'brightness(0.85)',
        }}
      />

      {/* Bottom gradient overlay for text contrast */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(transparent 30%, rgba(50, 30, 15, 0.7) 100%)',
        }}
      />

      {/* Headline */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '60px 80px',
          paddingBottom: 180,
        }}
      >
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
            color: '#FFFFFF',
            textAlign: 'center',
            lineHeight: 1.3,
            textShadow: '0 2px 8px rgba(0,0,0,0.6)',
            letterSpacing: '0.02em',
          }}
        >
          {headline}
        </div>
      </AbsoluteFill>

      {/* Brand watermark */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingBottom: 80,
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.1em',
          }}
        >
          AI懶人報 PODCAST
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
