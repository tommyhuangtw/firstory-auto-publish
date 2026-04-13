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
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Darkened sloth background */}
      <Img
        src={resolveSrc(backgroundImageSrc)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'brightness(0.35)',
        }}
      />

      {/* Headline */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: '60px 80px',
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
            textShadow:
              '0 0 40px rgba(255,255,255,0.4), 0 0 80px rgba(255,255,255,0.2), 0 4px 12px rgba(0,0,0,0.8)',
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
