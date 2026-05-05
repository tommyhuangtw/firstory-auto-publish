import React from 'react';
import { AbsoluteFill } from 'remotion';

export type YouTubeThumbnailProps = {
  hookText: string;
  segmentType: 'daily' | 'weekly' | 'robot' | 'sysdesign';
};

const SEGMENT_GRADIENTS: Record<string, string> = {
  daily: 'linear-gradient(135deg, #1a73e8 0%, #0d47a1 50%, #1565c0 100%)',
  weekly: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 50%, #388e3c 100%)',
  robot: 'linear-gradient(135deg, #c62828 0%, #b71c1c 50%, #d32f2f 100%)',
  sysdesign: 'linear-gradient(135deg, #6a1b9a 0%, #4a148c 50%, #7b1fa2 100%)',
};

export const YouTubeThumbnail: React.FC<YouTubeThumbnailProps> = ({
  hookText,
  segmentType,
}) => {
  const gradient = SEGMENT_GRADIENTS[segmentType] || SEGMENT_GRADIENTS.daily;

  // Auto-size font: shorter text gets bigger font
  const charCount = hookText.length;
  const fontSize = charCount <= 4 ? 120 : charCount <= 6 ? 100 : charCount <= 8 ? 86 : 72;

  return (
    <AbsoluteFill style={{ background: gradient }}>
      {/* Decorative geometric shapes */}
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -40,
          left: -40,
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.04)',
        }}
      />

      {/* Left decorative bar */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          background: 'rgba(255,255,255,0.15)',
        }}
      />

      {/* Main content area — centered hook text */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 80px',
        }}
      >
        <div
          style={{
            fontSize,
            fontWeight: 900,
            fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
            color: '#FFFFFF',
            textAlign: 'center',
            lineHeight: 1.25,
            textShadow: '0 4px 20px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.3)',
            letterSpacing: '0.03em',
            whiteSpace: 'pre-line',
          }}
        >
          {hookText}
        </div>
      </AbsoluteFill>

      {/* Bottom-right brand hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          right: 40,
          fontSize: 20,
          fontWeight: 600,
          fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
          color: 'rgba(255,255,255,0.35)',
          letterSpacing: '0.08em',
        }}
      >
        AI懶人報
      </div>
    </AbsoluteFill>
  );
};
