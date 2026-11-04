import * as React from 'react';
import { ArrowLeft, CheckCheck, CircleHelp, Download, Eraser, Eye, FolderInput, FolderPlus, GalleryVerticalEnd, ImageMinus, Minus, MoreHorizontal, Plus, Scan, SlidersHorizontal, SquareDashedMousePointer, Undo2, X } from 'lucide-react';

export const actionIcons = {
  back: ArrowLeft, select: SquareDashedMousePointer, selected: CheckCheck,
  createStash: FolderPlus, moveToStash: FolderInput, removeImage: ImageMinus,
  inspect: Eye, add: Plus, export: Download, clearBoard: Eraser, undo: Undo2,
  explore: GalleryVerticalEnd, help: CircleHelp, more: MoreHorizontal, close: X, zoomOut: Minus, pileOptions: SlidersHorizontal, fit: Scan,
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
