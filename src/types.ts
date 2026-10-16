export type Mode = 'setup' | 'sort' | 'end';

export const TEXT_CARD_COLOR_KEYS = ['slate', 'sand', 'mint', 'sky', 'rose', 'amber'] as const;

export type TextCardColorKey = (typeof TEXT_CARD_COLOR_KEYS)[number];

export type CardLayoutMode = 'as-is' | 'fixed-16-9' | 'fixed-9-16';

export type CardKind = 'text' | 'image' | 'video';

export interface CardMetadataV1 {
  name: string;
  notes: string;
  tags: string[];
  frontText?: string;
  color?: TextCardColorKey;
  aspectRatio?: number;
  durationSec?: number;
  originalFileName?: string;
}

export interface CardData {
  id: string;
  kind: CardKind;
  createdAt: number;
  // Media cards are backed by a persisted assetId (blob in IndexedDB).
  // src is the runtime object URL (derived from the blob), not stable across reloads.
  assetId?: string;
  src?: string;
  // Videos may also persist a lightweight poster image asset for fast board rendering.
  posterAssetId?: string;
  posterSrc?: string;
  meta: CardMetadataV1;
  sizeScale?: number;
  stackId?: string;
  stackOrder?: number;
  x: number;
  y: number;
  z: number;
}

export type CameraFrameSource = 'initial' | 'zoom' | 'pan' | 'resize';

export interface CameraKeyframe {
  tMs: number;
  scale: number;
  centerX: number;
  centerY: number;
  viewportW: number;
  viewportH: number;
  source: CameraFrameSource;
}
