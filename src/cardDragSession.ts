/** Native quick-release and Motion report the same gesture; exactly one may complete it. */
export class CardDragSession {
  phase: 'idle' | 'pressed' | 'dragging' | 'completed' | 'cancelled' = 'idle';
  selectedOnPress = false;
  dragged = false;
  get cancelled() { return this.phase === 'cancelled'; }
  press(selected: boolean) { this.phase = 'pressed'; this.selectedOnPress = selected; this.dragged = false; }
  start() {
    if (this.phase === 'completed' || this.cancelled) return false;
    this.phase = 'dragging'; this.dragged = true; return true;
  }
  quickRelease() {
    if (this.phase !== 'pressed') return false;
    this.phase = 'completed'; this.dragged = true; return true;
  }
  complete() {
    if (this.phase === 'completed' || this.cancelled) return false;
    this.phase = 'completed'; return true;
  }
  cancel() {
    if (this.phase === 'completed' || this.cancelled) return false;
    this.phase = 'cancelled'; return true;
  }
}
