import React from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

type Props = {
  videoSrc?: string;
  fallbackImg: string;
};

/**
 * Resolve a src that may be an absolute URL or a path relative to remotion/public/.
 */
const resolveSrc = (src: string): string => {
  if (/^(https?:|file:|data:)/.test(src)) return src;
  return staticFile(src);
};

/**
 * Center-stage sloth overlay used during the hook and outro segments.
 *
 * If a lip-synced video src is provided (Hedra Character-3 output), we play it
 * muted on top of the main composition (master audio track lives in the root).
 * Otherwise we fall back to the static avatar image so the pipeline still
 * renders sanely when HEDRA_API_KEY is missing.
 */
export const SlothOverlay: React.FC<Props> = ({ videoSrc, fallbackImg }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle entry scale so the cut doesn't feel snappy
  const enter = interpolate(frame, [0, 8], [0.94, 1], {
    extrapolateRight: 'clamp',
  });

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
          transform: `scale(${enter})`,
          background: '#0a0a14',
        }}
      >
        {videoSrc ? (
          <OffthreadVideo
            src={resolveSrc(videoSrc)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            playbackRate={1}
          />
        ) : (
          <Img
            src={resolveSrc(fallbackImg)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
