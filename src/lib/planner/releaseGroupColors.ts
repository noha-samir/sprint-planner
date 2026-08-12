import type { CSSProperties } from "react";
import { normalizeReleaseGroup } from "@/lib/scheduler/releaseGroups";

export type NudeReleaseGroupColor = {
  backgroundColor: string;
  borderColor: string;
  color: string;
};

/** Curated soft palette — distinct but cohesive, easy on the eye. */
const NUDE_PALETTE: NudeReleaseGroupColor[] = [
  { backgroundColor: "#fff1e8", borderColor: "#f0cbb3", color: "#8a4f34" }, // champagne peach
  { backgroundColor: "#fde8ef", borderColor: "#efbfcf", color: "#8a3f5a" }, // soft blush
  { backgroundColor: "#f4f0e4", borderColor: "#ddd4b8", color: "#6f6540" }, // warm linen
  { backgroundColor: "#eaf3ec", borderColor: "#bfd9c6", color: "#3f6a4e" }, // soft sage
  { backgroundColor: "#f3ece8", borderColor: "#d9c5b8", color: "#6f5144" }, // soft clay
  { backgroundColor: "#efeaf7", borderColor: "#cfc0e6", color: "#5a4578" }, // lilac mist
  { backgroundColor: "#fff6df", borderColor: "#ebd59a", color: "#7a6528" }, // cream gold
  { backgroundColor: "#f7ebe7", borderColor: "#dfc2b8", color: "#7a4f45" }, // rose taupe
  { backgroundColor: "#e8f2f6", borderColor: "#b7d5e0", color: "#3d6678" }, // powder aqua
  { backgroundColor: "#ffeadc", borderColor: "#f0bf98", color: "#8a5230" }, // apricot cream
  { backgroundColor: "#f0ebe4", borderColor: "#d4c8b6", color: "#655848" }, // stone cream
  { backgroundColor: "#f8e9f2", borderColor: "#e0bdd4", color: "#7a4568" }, // petal mauve
  { backgroundColor: "#eef5e4", borderColor: "#c9dbad", color: "#51683a" }, // soft olive
  { backgroundColor: "#ffe9e5", borderColor: "#f0bdb4", color: "#8a4740" }, // coral cream
  { backgroundColor: "#ebe9f5", borderColor: "#c6c1e0", color: "#4f4a72" }, // soft periwinkle
  { backgroundColor: "#fff3d6", borderColor: "#e6c97e", color: "#7a6120" }, // honey cream
  { backgroundColor: "#e8f1ee", borderColor: "#b9d2c8", color: "#3f655c" }, // seafoam
  { backgroundColor: "#f8e6dc", borderColor: "#e2b8a0", color: "#82503a" }, // terracotta cream
  { backgroundColor: "#e6f4f0", borderColor: "#b4dbd0", color: "#38665c" }, // mint cream
  { backgroundColor: "#f4e8f3", borderColor: "#dbbdd8", color: "#6d4a6a" }, // soft plum
  { backgroundColor: "#fff8e8", borderColor: "#ead7a4", color: "#756228" }, // pale butter
  { backgroundColor: "#efe6df", borderColor: "#d2bfb2", color: "#655044" }, // cocoa cream
  { backgroundColor: "#e7f0f8", borderColor: "#b6cfe4", color: "#3d5f78" }, // sky cream
  { backgroundColor: "#fde9ea", borderColor: "#e8b8bc", color: "#824548" }, // soft cherry
];

const nudeColorAt = (index: number): NudeReleaseGroupColor => {
  if (index >= 0 && index < NUDE_PALETTE.length) {
    return NUDE_PALETTE[index]!;
  }
  const hue = Math.round(((index * 47.3) % 360) * 10) / 10;
  return {
    backgroundColor: `hsl(${hue} 42% 93%)`,
    borderColor: `hsl(${hue} 34% 76%)`,
    color: `hsl(${hue} 32% 32%)`,
  };
};

/**
 * Stable unique nude color per release group name among the provided set.
 */
export const buildReleaseGroupColorMap = (
  groups: Iterable<string | null | undefined>,
): Map<string, NudeReleaseGroupColor> => {
  const unique = [
    ...new Set(
      [...groups]
        .map((group) => normalizeReleaseGroup(group))
        .filter((group): group is string => group != null),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const map = new Map<string, NudeReleaseGroupColor>();
  unique.forEach((group, index) => {
    map.set(group, nudeColorAt(index));
  });
  return map;
};

export const releaseGroupInputStyle = (
  group: string | null | undefined,
  colorMap: Map<string, NudeReleaseGroupColor>,
): CSSProperties | undefined => {
  const key = normalizeReleaseGroup(group);
  if (!key) {
    return undefined;
  }
  const swatch = colorMap.get(key);
  if (!swatch) {
    return undefined;
  }
  return {
    backgroundColor: swatch.backgroundColor,
    borderColor: swatch.borderColor,
    color: swatch.color,
  };
};
