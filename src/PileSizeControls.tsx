import * as React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { pileSizeGeometry } from './pileSizing';

type Props = {
  geometry: ReturnType<typeof pileSizeGeometry>;
  onHeight: (height: number) => void;
  onImageSize: (size: number) => void;
  onReset: () => void;
};

export default function PileSizeControls({ geometry, onHeight, onImageSize, onReset }: Props) {
  const details = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current?.open && event.target instanceof Node && !details.current.contains(event.target)) details.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <details ref={details} className="pile-size" onKeyDown={event => {
    if (event.key === 'Escape' && details.current?.open) {
      event.preventDefault(); event.stopPropagation(); details.current.open = false;
      details.current.querySelector('summary')?.focus();
    }
  }}>
    <summary aria-label="Pile size controls" title="Resize the pile and its images"><SlidersHorizontal size={17} /><span>Size</span></summary>
    <div className="pile-size__panel" role="group" aria-label="Pile sizing">
      <label><span>Image size <output>{geometry.imageSize} px</output></span><input type="range" aria-label="Pile image size" min={72} max={geometry.maxImageSize} step={8} value={geometry.imageSize} onChange={event => onImageSize(Number(event.target.value))} /></label>
      <label><span>Pane height <output>{geometry.paneHeight} px</output></span><input type="range" aria-label="Pile pane height" min={geometry.minHeight} max={geometry.maxHeight} value={geometry.paneHeight} onChange={event => onHeight(Number(event.target.value))} /></label>
      <p>Drag the divider to give the pile more room.</p>
      <button type="button" onClick={onReset}><RotateCcw size={14} />Reset size</button>
    </div>
  </details>;
}
