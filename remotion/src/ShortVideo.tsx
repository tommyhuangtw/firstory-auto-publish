import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { AnimatedCaption } from './components/AnimatedCaption';
import { SlothOverlay } from './components/SlothOverlay';
import { BRollLayer, BRollClip } from './components/BRollLayer';

/**
 * Resolve a src that may either be:
 *   - already a full URL (http://, file://, data:)
 *   - a path relative to remotion/public/  →  pass through staticFile()
 */
const resolveSrc = (src: string): string => {
  if (/^(https?:|file:|data:)/.test(src)) return src;
  return staticFile(src);
};

export type CaptionWord = {
  word: string;
  start: number; // seconds, absolute on master timeline
  end: number;   // seconds, absolute on master timeline
};

export type Caption = {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  /**
   * Optional per-word timings for CapCut-style active-word highlight.
   * If absent, AnimatedCaption falls back to a single-block spring-in.
   */
  words?: CaptionWord[];
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
  // Phase 3: b-roll background behind the clip segment
  brollClips?: BRollClip[];
  // Phase 4: sloth reaction shots interleaved during clip segment
  slothClipSlots?: { start: number; end: number }[];
  slothClipVideoSrc?: string;
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

/**
 * Animated yellow pill headline. Visible during hook + outro segments with
 * spring-in + fade-out. Hidden during the main clip segment so it doesn't
 * cover the B-roll like a static banner ad.
 */
const AnimatedHeadline: React.FC<{
  headline: string;
  fps: number;
  hookFrames: number;
  outroStart: number;
  totalFrames: number;
}> = ({ headline, fps, hookFrames, outroStart, totalFrames }) => {
  const frame = useCurrentFrame();

  // Hook segment: spring in from above, hold, then fade out as clip starts
  const hookEnterSpring = spring({
    frame,
    fps,
    from: -120,
    to: 0,
    config: { damping: 14, stiffness: 110 },
    durationInFrames: 14,
  });
  const hookEnterOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const hookExitOpacity = interpolate(
    frame,
    [Math.max(0, hookFrames - 6), hookFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Outro segment: spring back in, hold, fade out in final frames
  const outroEnterSpring = spring({
    frame: frame - outroStart,
    fps,
    from: -120,
    to: 0,
    config: { damping: 14, stiffness: 110 },
    durationInFrames: 14,
  });
  const outroEnterOpacity = interpolate(
    frame,
    [outroStart, outroStart + 10],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  const outroExitOpacity = interpolate(
    frame,
    [Math.max(outroStart, totalFrames - 8), totalFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  let translateY = 0;
  let opacity = 0;
  if (frame < hookFrames) {
    translateY = hookEnterSpring;
    opacity = Math.min(hookEnterOpacity, hookExitOpacity);
  } else if (frame >= outroStart) {
    translateY = outroEnterSpring;
    opacity = Math.min(outroEnterOpacity, outroExitOpacity);
  } else {
    // Middle clip segment — fully hidden
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 80,
        opacity,
        transform: `translateY(${translateY}px)`,
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
          letterSpacing: 2,
          boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
        }}
      >
        {headline}
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
  brollClips = [],
  slothClipSlots = [],
  slothClipVideoSrc,
}) => {
  const hasBroll = brollClips.length > 0;
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
      {/* Background: blurred zoomed cover — always present as a safety net */}
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

      {/* B-roll layer sits above the blurred cover, below the foreground */}
      {hasBroll && <BRollLayer clips={brollClips} />}

      {/* Foreground: three segments — hook sloth, (cover if no B-roll), outro sloth */}
      {hookFrames > 0 && (
        <Sequence from={0} durationInFrames={hookFrames}>
          <SlothOverlay videoSrc={slothHookVideoSrc} fallbackImg={avatarImageSrc} />
        </Sequence>
      )}
      {clipFrames > 0 && !hasBroll && (
        <Sequence from={hookFrames} durationInFrames={clipFrames}>
          <CoverCenter imgSrc={resolvedAvatar} totalDurationSec={totalDurationSec} />
        </Sequence>
      )}
      {outroFrames > 0 && (
        <Sequence from={outroStart} durationInFrames={outroFrames}>
          <SlothOverlay videoSrc={slothOutroVideoSrc} fallbackImg={avatarImageSrc} />
        </Sequence>
      )}
      {/* Sloth reaction shots interleaved during the clip segment */}
      {slothClipSlots.map((slot, i) => {
        const startFrame = Math.round(slot.start * fps);
        const durFrames = Math.max(1, Math.round((slot.end - slot.start) * fps));
        return (
          <Sequence key={`sloth-clip-${i}`} from={startFrame} durationInFrames={durFrames}>
            <SlothOverlay videoSrc={slothClipVideoSrc} fallbackImg={avatarImageSrc} />
          </Sequence>
        );
      })}
      {/* Fallback when hook/outro durations are unknown (Phase 1 style render) */}
      {hookFrames === 0 && outroFrames === 0 && (
        <CoverCenter imgSrc={resolvedAvatar} totalDurationSec={totalDurationSec} />
      )}

      {/* Animated headline strip — springs in during the hook, fades for the
          clip segment, springs back in for the outro. */}
      <AnimatedHeadline
        headline={headline}
        fps={fps}
        hookFrames={hookFrames}
        outroStart={outroStart}
        totalFrames={totalFrames}
      />

      {/* Animated captions, one Sequence per caption block */}
      {captions.map((cap, i) => {
        const startFrame = Math.round(cap.start * fps);
        const durationFrames = Math.max(1, Math.round((cap.end - cap.start) * fps));
        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationFrames}>
            <AnimatedCaption
              text={cap.text}
              words={cap.words}
              captionStart={cap.start}
            />
          </Sequence>
        );
      })}

      {/* Audio track */}
      <Audio src={resolvedAudio} />
    </AbsoluteFill>
  );
};
