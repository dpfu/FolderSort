import * as React from 'react';
import { ArrowLeft, CheckCheck, CircleHelp, Download, Eraser, Eye, FolderInput, FolderPlus, GalleryVerticalEnd, Minus, MoreHorizontal, Plus, SlidersHorizontal, SquareDashedMousePointer, Undo2, X } from 'lucide-react';

export function ReturnToPileIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="return-to-pile">
    <path d="m3 14 9 4 9-4M3 18l9 4 9-4M3 10l9 4 5-2" /><path d="M21 2v3a3 3 0 0 1-3 3h-5m3-3-3 3 3 3" />
  </svg>;
}

export const actionIcons = {
  back: ArrowLeft, select: SquareDashedMousePointer, selected: CheckCheck,
  createStash: FolderPlus, moveToStash: FolderInput, returnToPile: ReturnToPileIcon,
  inspect: Eye, add: Plus, export: Download, clearBoard: Eraser, undo: Undo2,
  explore: GalleryVerticalEnd, help: CircleHelp, more: MoreHorizontal, close: X, zoomOut: Minus, pileOptions: SlidersHorizontal,
};
export type ActionIcon = keyof typeof actionIcons;

export function ActionButton({ icon, label, title = label, className = '', children, ...props }: {
  icon: ActionIcon; label: string; title?: string; className?: string; children?: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'aria-label'>) {
  const Icon = actionIcons[icon];
  return <button type="button" {...props} className={`action-button ${className}`} aria-label={label} title={title} data-action={icon}><Icon size={20} aria-hidden="true" />{children}</button>;
}

export function MenuItem({ icon, label, ...props }: { icon: ActionIcon; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const Icon = actionIcons[icon];
  return <button type="button" {...props} className={`action-menu__item ${props.className || ''}`} data-close-menu data-action={icon}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>;
}
