import type { BBox } from './types';
export type SegmentedRegion = { imageUrl: string; maskUrl: string; bbox: BBox };
export type GroundedItem = SegmentedRegion & { name: string; category: string; confidence: number };
export function warmupVision(): Promise<unknown>;
export function scanGrounded(frame: Buffer): Promise<GroundedItem[]>;
export function segmentGrounded(frame: Buffer, bbox: BBox): Promise<SegmentedRegion>;
