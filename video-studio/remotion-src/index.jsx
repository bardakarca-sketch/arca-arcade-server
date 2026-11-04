import {registerRoot, Composition, AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig} from 'remotion';
import React from 'react';
const Hello = () => {
  const f = useCurrentFrame(); const {fps} = useVideoConfig();
  const s = spring({frame: f, fps});
  return <AbsoluteFill style={{background: '#111', justifyContent: 'center', alignItems: 'center'}}>
    <div style={{color: '#ffd400', fontSize: 120, fontFamily: 'sans-serif', fontWeight: 900, transform: `scale(${s})`, opacity: interpolate(f, [0, 20], [0, 1])}}>Remotion OK</div>
  </AbsoluteFill>;
};
const Root = () => <Composition id="Hello" component={Hello} durationInFrames={60} fps={30} width={1080} height={1920} />;
registerRoot(Root);
