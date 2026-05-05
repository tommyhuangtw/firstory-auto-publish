import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';

export type ReelsCoverProps = {
  headline: string;
  backgroundImageSrc: string;
  paddingTop?: number;
  topPercent?: number;
  fontSize?: number;
};

const resolveSrc = (src: string): string => {
  if (/^(https?:|file:|data:)/.test(src)) return src;
  return staticFile(src);
};

export const ReelsCover: React.FC<ReelsCoverProps> = ({
  headline,
  backgroundImageSrc,
  paddingTop: customPaddingTop,
  topPercent,
  fontSize: customFontSize,
}) => {
  const headlineFontSize = customFontSize ?? 96;
  // Determine headline positioning:
  // - If topPercent is provided (new API), use absolute top positioning
  // - Otherwise fall back to flex center + paddingTop (legacy)
  const useAbsoluteTop = topPercent != null;

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

      {/* Gradient overlay shifted below center for text contrast */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(transparent 35%, rgba(20, 10, 5, 0.65) 55%, rgba(20, 10, 5, 0.65) 75%, transparent 92%)',
        }}
      />

      {/* Headline */}
      {useAbsoluteTop ? (
        <div
          style={{
            position: 'absolute',
            top: `${topPercent}%`,
            left: 80,
            right: 80,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: headlineFontSize,
              fontWeight: 900,
              fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
              color: '#FFFFFF',
              lineHeight: 1.3,
              textShadow: '0 2px 12px rgba(0,0,0,0.7)',
              letterSpacing: '0.02em',
              whiteSpace: 'pre-line',
            }}
          >
            {headline}
          </div>
        </div>
      ) : (
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 80px',
            paddingTop: customPaddingTop ?? 400,
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
              textShadow: '0 2px 12px rgba(0,0,0,0.7)',
              letterSpacing: '0.02em',
              whiteSpace: 'pre-line',
            }}
          >
            {headline}
          </div>
        </AbsoluteFill>
      )}

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
