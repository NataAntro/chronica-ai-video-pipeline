import React from "react";
import { Composition } from "remotion";
import type { RenderProps } from "../domain/types.ts";
import { TechDigest } from "./TechDigest.tsx";

const defaultProps: RenderProps = {
  title: "Технологический радар",
  edition: "Демо",
  sections: [{ title: "Программный media pipeline", accent: "#68D8D6" }],
  subtitles: [],
  audioPath: "generated/preview.wav",
  durationInFrames: 120,
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="TechDigest"
    component={TechDigest}
    durationInFrames={defaultProps.durationInFrames}
    fps={24}
    width={640}
    height={360}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.durationInFrames,
    })}
  />
);
