import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { AnimatedCaption } from './components/AnimatedCaption';
import { SlothOverlay } from './components/SlothOverlay';

/**
 * Resolve a src that may either be:
 *   - already a full URL (http://, file://, data:)
 *   - a path relative to remotion/public/  →  pass through staticFile()
 */
const resolveSrc = (src: string): string => {
  if (/^(https?:|file:|data:)/.test(src)) return src;
  return staticFile(src);
};

export type Caption = {
  text: string;
  start: number; // seconds
  end: number; // seconds
};

export type ShortVideoProps = {
  audioSrc: string;
  avatarImageSrc: string;
  headline: string;
  captions: Caption[];
  totalDurationSec: number;
  // Phase 2: Hedra Character-3 lip-sync overlays during hook + outro
  slothHookVideoSrc?: string;
  slothOutroVideoSrc?: string;
  hookDurationSec?: number;
  outroDurationSec?: number;
  // Phase 3 (optional): b-roll background
  brollClips?: { src: string; start: number; end: number }[];
};

/**
 * Static cover image for the middle "clip" segment (between hook & outro).
 * Phase 3 will replace this with a B-roll layer; Phase 1/2 keeps the Ken Burns
 * cover so the composition always has something visually alive.
 */
const CoverCenter: React.FC<{ imgSrc: string; totalDurationSec: number }> = ({
  imgSrc,
  totalDurationSec,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const zoom = 1 + (t / Math.max(1, totalDurationSec)) * 0.08;
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 200,
      }}
    >
      <div
        style={{
          width: 820,
          height: 820,
          borderRadius: 60,
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          transform: `scale(${zoom})`,
        }}
      >
        <Img
          src={imgSrc}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const ShortVideo: React.FC<ShortVideoProps> = ({
  audioSrc,
  avatarImageSrc,
  headline,
  captions,
  totalDurationSec,
  slothHookVideoSrc,
  slothOutroVideoSrc,
  hookDurationSec = 0,
  outroDurationSec = 0,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;

  const resolvedAudio = resolveSrc(audioSrc);
  const resolvedAvatar = resolveSrc(avatarImageSrc);

  // Subtle Ken Burns on the blurred background so a static image doesn't feel dead
  const zoom = 1 + (t / Math.max(1, totalDurationSec)) * 0.08;

  // Frame-level segment boundaries for hook / clip / outro
  const totalFrames = Math.max(1, Math.round(totalDurationSec * fps));
  const hookFrames = Math.max(0, Math.round(hookDurationSec * fps));
  const outroFrames = Math.max(0, Math.round(outroDurationSec * fps));
  const outroStart = Math.max(hookFrames, totalFrames - outroFrames);
  const clipFrames = Math.max(0, outroStart - hookFrames);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a14', overflow: 'hidden' }}>
      {/* Background: blurred zoomed cover */}
      <AbsoluteFill style={{ filter: 'blur(40px) brightness(0.5)' }}>
        <Img
          src={resolvedAvatar}
          style={{
            width: '120%',
            height: '120%',
            objectFit: 'cover',
            transform: `scale(${zoom})`,
            marginLeft: '-10%',
            marginTop: '-10%',
          }}
        />
      </AbsoluteFill>

      {/* Foreground: three segments — hook sloth, cover, outro sloth */}
      {hookFrames > 0 && (
        <Sequence from={0} durationInFrames={hookFrames}>
          <SlothOverlay videoSrc={slothHookVideoSrc} fallbackImg={avatarImageSrc} />
        </Sequence>
      )}
      {clipFrames > 0 && (
        <Sequence from={hookFrames} durationInFrames={clipFrames}>
          <CoverCenter imgSrc={resolvedAvatar} totalDurationSec={totalDurationSec} />
        </Sequence>
      )}
      {outroFrames > 0 && (
        <Sequence from={outroStart} durationInFrames={outroFrames}>
          <SlothOverlay videoSrc={slothOutroVideoSrc} fallbackImg={avatarImageSrc} />
        </Sequence>
      )}
      {/* Fallback when hook/outro durations are unknown (Phase 1 style render) */}
      {hookFrames === 0 && outroFrames === 0 && (
        <CoverCenter imgSrc={resolvedAvatar} totalDurationSec={totalDurationSec} />
      )}

      {/* Headline strip at the top */}
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: 80,
        }}
      >
        <div
          style={{
            backgroundColor: 'rgba(255, 220, 70, 0.95)',
            color: '#1a1a2e',
            padding: '24px 56px',
            borderRadius: 999,
            fontSize: 64,
            fontWeight: 900,
            fontFamily: '"PingFang TC", "Noto Sans TC", system-ui, sans-serif',
            letterSpacing: 2,
            boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
          }}
        >
          {headline}
        </div>
      </AbsoluteFill>

      {/* Animated captions, one Sequence per caption block */}
      {captions.map((cap, i) => {
        const startFrame = Math.round(cap.start * fps);
        const durationFrames = Math.max(1, Math.round((cap.end - cap.start) * fps));
        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <AnimatedCaption text={cap.text} />
          </Sequence>
        );
      })}

      {/* Audio track */}
      <Audio src={resolvedAudio} />
    </AbsoluteFill>
  );
};
