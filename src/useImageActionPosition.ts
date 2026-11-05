import * as React from 'react';
import type { MotionValue } from 'framer-motion';

/** Keep the selected photo's controls reachable without moving the photo or camera. */
export function useImageActionPosition(cardRef: React.RefObject<HTMLDivElement>, active: boolean, scale: number, x: MotionValue<number>, y: MotionValue<number>) {
  React.useLayoutEffect(() => {
    if (!active) return;
    const card = cardRef.current, action = card?.querySelector<HTMLElement>('.card__imageAction');
    const board = card?.closest<HTMLElement>('[data-testid="board-root"]');
    if (!card || !action || !board) return;
    let pending = 0;
    const place = () => {
      const box = card.getBoundingClientRect(), bounds = board.getBoundingClientRect(), controls = action.getBoundingClientRect();
      const photo = card.querySelector<HTMLImageElement>('.cardPreview__img');
      const fit = photo?.naturalWidth && photo.naturalHeight ? Math.min(box.width / photo.naturalWidth, box.height / photo.naturalHeight) : 1;
      const width = photo?.naturalWidth ? photo.naturalWidth * fit : box.width;
      const height = photo?.naturalHeight ? photo.naturalHeight * fit : box.height;
      const left = box.left + (box.width - width) / 2, top = box.top + (box.height - height) / 2;
      const minX = Math.max(0, bounds.left) + 8, maxX = Math.min(window.innerWidth, bounds.right) - controls.width - 8;
      const minY = Math.max(0, bounds.top) + 8, maxY = Math.min(window.innerHeight, bounds.bottom) - controls.height - 8;
      const rightFits = left + width + 9 <= maxX;
      const targetX = Math.max(minX, Math.min(maxX, rightFits ? left + width + 9 : left - controls.width - 9));
      action.style.left = (targetX - box.left) / scale + 'px';
      action.style.top = (Math.max(minY, Math.min(maxY, top)) - box.top) / scale + 'px';
      action.dataset.side = rightFits ? 'right' : 'left';
    };
    const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(place); };
    place();
    const resize = new ResizeObserver(schedule); resize.observe(board); resize.observe(action);
    const camera = new MutationObserver(schedule);
    const canvas = card.closest('[data-testid="board-canvas"]');
    if (canvas) camera.observe(canvas, { attributes: true, attributeFilter: ['style'] });
    const stopX = x.on('change', schedule), stopY = y.on('change', schedule);
    card.addEventListener('load', schedule, true);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(pending); resize.disconnect(); camera.disconnect(); stopX(); stopY();
      card.removeEventListener('load', schedule, true);
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    };
  }, [cardRef, active, scale, x, y]);
}
