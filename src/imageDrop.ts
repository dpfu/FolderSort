type Point = { x: number; y: number };
export type ImageDragSource =
  | { kind: 'board' }
  | { kind: 'browser' }
  | { kind: 'folder-preview'; folderId: string };
export type ImageDrop =
  | { kind: 'parent'; folderId: string | null }
  | { kind: 'group'; imageId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'waiting' }
  | { kind: 'place'; point: Point }
  | { kind: 'reject' };

/** Hit testing stays in the workspace; decisions have no mutations or DOM effects. */
export function resolveImageDrop(input: {
  source: ImageDragSource;
  staging: boolean;
  parent?: { folderId: string | null };
  groupingImageId?: string;
  folderId?: string | null;
  overBrowser?: boolean;
  boardPoint?: Point | null;
}): ImageDrop {
  if (input.parent) return { kind: 'parent', ...input.parent };
  if (input.groupingImageId) return { kind: 'group', imageId: input.groupingImageId };
  if (input.folderId)
    return input.source.kind === 'folder-preview' && input.folderId === input.source.folderId
      ? { kind: 'reject' }
      : { kind: 'folder', folderId: input.folderId };
  if (input.source.kind === 'board' && input.overBrowser)
    return { kind: input.staging ? 'waiting' : 'reject' };
  if (input.boardPoint) return { kind: 'place', point: input.boardPoint };
  return { kind: 'reject' };
}
