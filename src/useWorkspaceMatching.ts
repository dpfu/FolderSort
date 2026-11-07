import type * as React from 'react';
import type { AsyncTask } from './asyncTask';
import type { BoardEdit } from './boardEdit';
import type { SimilarMatch } from './imageAnalysis';
import type { SimilarityMethod } from './SimilarImageAdd';
import type { LibraryImage, LibraryCategory } from './libraryStore';
import type { ContentIndex } from './useContentAnalysis';
import type { ImageAnalysis } from './useImageAnalysis';
import type { BoardMove } from './useImageIntake';
import type { StashTile } from './stashBoard';
import { imageOnScopeBoard } from './stashBoard';
import { similarityCandidates, similarityReferences } from './similarityScope';
import { placeSimilarImages } from './similarityLayout';
import { fitBoardView } from './stashView';
type Point = { x: number; y: number };
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type Options = {
  matchingTask: AsyncTask;
  busy: boolean;
  saving: boolean;
  scopeId: string | null;
  scopeRef: React.MutableRefObject<string | null>;
  imagesRef: React.MutableRefObject<LibraryImage[]>;
  clipEnabled: boolean;
  similarityMethod: SimilarityMethod;
  includeOtherStashes: boolean;
  analysis: Pick<ImageAnalysis, 'ensure' | 'client' | 'colors'>;
  content: Pick<ContentIndex, 'progress' | 'ensureReferences' | 'similar'>;
  boardRef: React.RefObject<HTMLDivElement>;
  boardPaneRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  worldHeight: number;
  categoryLayout: { groups: StashTile[] };
  currentStash?: LibraryCategory;
  framedFolders: Set<string>;
  intake: { settle: (moves: BoardMove[]) => void; animate: (ids: string[]) => void };
  setAnalysisNotice: (notice: string) => void;
  setSelectedIds: Setter<Set<string>>;
  setSelectedId: Setter<string | null>;
  setZoom: Setter<number>;
  setCameraCenter: Setter<Point | undefined>;
  raiseIncoming: (ids: string[]) => void;
  onPlaceOnBoard: (moves: BoardMove[]) => BoardEdit;
  addMarkedToBoard: (ids: string[]) => void;
  revealImages: (ids: string[]) => void;
};
/** Own matching requests; placement strategies and research algorithms stay unchanged. */
export function useWorkspaceMatching(options: Options) {
  const {
    matchingTask,
    busy,
    saving,
    scopeId,
    scopeRef,
    imagesRef,
    clipEnabled,
    similarityMethod,
    includeOtherStashes,
    boardRef,
    boardPaneRef,
    zoom,
    worldHeight,
    categoryLayout,
    currentStash,
    framedFolders,
    intake,
    setAnalysisNotice,
    setSelectedIds,
    setSelectedId,
    setZoom,
    setCameraCenter,
    raiseIncoming,
    onPlaceOnBoard,
    addMarkedToBoard,
    revealImages,
  } = options;
  const { ensure: ensureAnalysis, client: analysisClient, colors } = options.analysis;
  const {
    progress: clipProgress,
    ensureReferences: ensureClipReferences,
    similar: similarContent,
  } = options.content;
  const drawSize = 3,
    CARD_WIDTH = 172,
    WORLD_WIDTH = 2200;
  const findSimilarImages = async (
    referenceId?: string,
    method: SimilarityMethod = similarityMethod,
    count = drawSize,
    onlyNew = false,
    includeFolders = includeOtherStashes,
  ): Promise<SimilarMatch[]> => {
    if (method === 'color') await ensureAnalysis('color');
    if (!matchingTask.active) return [];
    const current = imagesRef.current;
    const references = similarityReferences(current, scopeId, referenceId);
    const candidates = similarityCandidates(
      current,
      scopeId,
      new Set(references.map((image) => image.id)),
      includeFolders,
    ).filter((image) => !onlyNew || !imageOnScopeBoard(image, scopeId));
    if (!candidates.length) return [];
    if (method === 'clip') {
      if (!clipEnabled) throw new Error('Subject similarity is off in project settings.');
      const referenceIds = await ensureClipReferences(references.map((image) => image.id));
      if (!referenceIds.length) throw new Error('No readable reference image on the board.');
      // Prepare a bounded starter pool on first use. Matching a single indexed
      // candidate is arbitrary; a small cohort makes the first add meaningful
      // without waiting for a large corpus to finish indexing.
      let matches = await similarContent(
        candidates.map((image) => image.id),
        referenceIds,
        count,
      );
      if (
        (clipProgress.done < Math.min(imagesRef.current.length, 13) || !matches.length) &&
        !['paused', 'error'].includes(clipProgress.phase)
      ) {
        await ensureClipReferences(candidates.slice(0, 12).map((image) => image.id));
        matches = await similarContent(
          candidates.map((image) => image.id),
          referenceIds,
          count,
        );
      }
      return matches;
    }
    if (!colors(references).length) throw new Error('No readable reference image on the board.');
    return analysisClient().similarColors(colors(candidates), colors(references), count);
  };
  const acceptSimilarPreview = async (
    matches: SimilarMatch[],
    moves: BoardMove[],
  ): Promise<BoardEdit> => {
    if (
      matchingTask.running ||
      busy ||
      saving ||
      !matches.length ||
      matches.length !== moves.length
    )
      return { status: 'unchanged' };
    const current = imagesRef.current,
      byId = new Map(current.map((image) => [image.id, image]));
    const references = new Set(matches.map((match) => match.referenceId));
    const allowed = new Set(
      similarityCandidates(current, scopeId, references, false)
        .filter((image) => !imageOnScopeBoard(image, scopeId))
        .map((image) => image.id),
    );
    // A stale draft must never take an image that has since been moved elsewhere.
    if (
      matches.some(
        (match) =>
          !allowed.has(match.id) ||
          !byId.get(match.referenceId) ||
          !imageOnScopeBoard(byId.get(match.referenceId)!, scopeId),
      ) ||
      moves.some((move) => !matches.some((match) => match.id === move.id))
    )
      return { status: 'unchanged' };
    const edit = onPlaceOnBoard(moves);
    if (edit.status !== 'accepted') return edit;
    framedFolders.add(scopeId || 'root');
    intake.settle(moves);
    raiseIncoming(moves.map((move) => move.id));
    setAnalysisNotice(
      `${scopeId ? 'Moved' : 'Added'} ${moves.length} ${moves.length === 1 ? 'image' : 'images'} ${scopeId ? 'into ' + currentStash?.name.split('/').at(-1) : 'to Staging'}.`,
    );
    return edit;
  };
  const addSimilar = async (
    referenceId?: string,
    method: SimilarityMethod = similarityMethod,
    preview?: SimilarMatch[],
  ) => {
    if (matchingTask.running || busy) return;
    const request = matchingTask.begin();
    if (!request) return;
    setAnalysisNotice('');
    try {
      const matches = preview ?? (await findSimilarImages(referenceId, method));
      if (!matchingTask.active || !matchingTask.owns(request) || scopeRef.current !== scopeId)
        return;
      // Recheck placement after the async search: dragging can continue during it.
      const byId = new Map(imagesRef.current.map((image) => [image.id, image]));
      const referenceIds = new Set(matches.map((match) => match.referenceId));
      const allowed = new Set(
        similarityCandidates(imagesRef.current, scopeId, referenceIds, includeOtherStashes).map(
          (image) => image.id,
        ),
      );
      const eligible = matches.filter((match) => {
        const image = byId.get(match.id),
          reference = byId.get(match.referenceId);
        return image && allowed.has(image.id) && reference && imageOnScopeBoard(reference, scopeId);
      });
      if (!eligible.length) {
        setAnalysisNotice(
          method === 'clip'
            ? 'No matches available in this search. Check Subject similarity in Project settings.'
            : 'No similar images in this search.',
        );
        return;
      }
      if (scopeId === null) {
        const ids = [
          ...new Set([
            ...eligible.map((match) => match.referenceId),
            ...eligible.map((match) => match.id),
          ]),
        ];
        const pending = eligible
          .filter((match) => byId.get(match.id)?.rootOnBoard === false)
          .map((match) => match.id);
        if (pending.length) {
          addMarkedToBoard(pending);
          setSelectedIds(new Set(ids));
          setSelectedId(pending[0]);
          revealImages(ids);
          return;
        }
        setSelectedIds(new Set(ids));
        setSelectedId(eligible[0].id);
        revealImages(ids);
        setAnalysisNotice(
          `${eligible.length} similar ${eligible.length === 1 ? 'image' : 'images'} found in Staging.`,
        );
        return;
      }
      const pane = boardPaneRef.current?.getBoundingClientRect();
      const canvas = boardRef.current
        ?.querySelector<HTMLElement>('[data-testid="board-canvas"]')
        ?.getBoundingClientRect();
      const viewport =
        pane && canvas
          ? {
              left: Math.max(0, (pane.left - canvas.left) / zoom),
              right: (pane.right - canvas.left) / zoom,
              top: Math.max(0, (pane.top - canvas.top) / zoom),
              bottom: (pane.bottom - canvas.top) / zoom,
            }
          : { left: 0, right: WORLD_WIDTH, top: 0, bottom: worldHeight };
      const positions = new Map(
        imagesRef.current
          .filter((image) => imageOnScopeBoard(image, scopeId))
          .map((image, index) => [
            image.id,
            {
              x: image.boardX ?? 110 + (index % 8) * 205,
              y: image.boardY ?? 130 + Math.floor(index / 8) * 215,
            },
          ]),
      );
      const moves = placeSimilarImages(eligible, positions, categoryLayout.groups, viewport);
      if (
        pane &&
        moves.some(
          (move) =>
            move.x < viewport.left ||
            move.y < viewport.top ||
            move.x + CARD_WIDTH > viewport.right ||
            move.y + CARD_WIDTH > viewport.bottom,
        )
      ) {
        const references = [...new Set(eligible.map((match) => match.referenceId))].map(
          (id) => positions.get(id)!,
        );
        const view = fitBoardView(
          [...references, ...moves].map((point) => ({
            ...point,
            width: CARD_WIDTH,
            height: CARD_WIDTH,
          })),
          pane.width,
          pane.height,
        );
        setZoom(view.zoom);
        setCameraCenter({ x: view.x, y: view.y });
      }
      intake.animate(moves.map((move) => move.id));
      onPlaceOnBoard(moves);
      setAnalysisNotice(
        `Moved ${moves.length} similar ${moves.length === 1 ? 'image' : 'images'} into ${currentStash?.name.split('/').at(-1) || 'Staging'}.`,
      );
    } catch (cause) {
      if (matchingTask.owns(request))
        setAnalysisNotice(
          cause instanceof Error ? cause.message : 'Could not find similar images.',
        );
    } finally {
      matchingTask.complete(request);
    }
  };

  return { findSimilarImages, acceptSimilarPreview, addSimilar };
}
