import React from 'react';
import { Composition, Still } from 'remotion';
import { ShortVideo, ShortVideoProps } from './ShortVideo';
import { ReelsCover, ReelsCoverProps } from './ReelsCover';

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;

// Default props for Remotion Studio preview only. The CLI render passes its
// own staged paths via --props=... so these are only seen in `npm run dev`.
// (Files must be copied to remotion/public/ for staticFile() to find them.)
const defaultProps: ShortVideoProps = {
  audioSrc: 'preview-audio.mp3',
  avatarImageSrc: 'preview-cover.jpg',
  headline: '本集精華',
  captions: [
    { text: '大家好歡迎收聽 AI 懶人報', start: 0, end: 2 },
    { text: '今天要聊一個非常重要的主題', start: 2, end: 4.5 },
    { text: 'ChatGPT 又進化了一大步', start: 4.5, end: 7 },
    { text: '這是一個轉捩點', start: 7, end: 9 },
  ],
  totalDurationSec: 10,
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ShortVideo"
        component={ShortVideo}
        durationInFrames={Math.round(defaultProps.totalDurationSec * FPS)}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={defaultProps}
        // Allow CLI/programmatic render to override duration based on real audio
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.round(props.totalDurationSec * FPS)),
        })}
      />
      <Still
        id="ReelsCover"
        component={ReelsCover}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{
          headline: 'AI駭客太狂了',
          backgroundImageSrc: 'sloth_studio_01.png',
        } as ReelsCoverProps}
      />
    </>
  );
};
