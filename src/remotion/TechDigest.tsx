import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { RenderProps } from "../domain/types.ts";

export const TechDigest: React.FC<RenderProps> = ({
  title,
  edition,
  sections,
  subtitles,
  audioPath,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const cue = subtitles.find(
    (item) => nowMs >= item.startMs && nowMs < item.endMs,
  );
  const sectionIndex = Math.min(
    sections.length - 1,
    Math.floor((frame / durationInFrames) * sections.length),
  );
  const section = sections[sectionIndex] ?? sections[0];
  const progress = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #07111f 0%, #10233d 100%)",
        color: "#f8fafc",
        fontFamily: "Arial, sans-serif",
        padding: 50,
      }}
    >
      <Audio src={staticFile(audioPath)} />
      <div style={{ color: "#94a3b8", fontSize: 16, letterSpacing: 3 }}>
        {edition.toUpperCase()}
      </div>
      <h1 style={{ fontSize: 38, lineHeight: 1.05, margin: "14px 0 24px" }}>
        {title}
      </h1>
      <div
        style={{
          borderLeft: `6px solid ${section?.accent ?? "#68D8D6"}`,
          padding: "16px 20px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 12,
          fontSize: 26,
          fontWeight: 700,
        }}
      >
        {section?.title}
      </div>
      <div style={{ flex: 1 }} />
      <div
        style={{
          minHeight: 70,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          fontSize: 20,
          lineHeight: 1.25,
          background: "rgba(2,6,23,0.82)",
          borderRadius: 14,
          padding: "14px 20px",
        }}
      >
        {cue?.text ?? "Еженедельный технологический дайджест"}
      </div>
      <div style={{ height: 5, background: "#1e293b", marginTop: 18 }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: "#68D8D6",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
