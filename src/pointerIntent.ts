/** macOS Control-click opens the context menu; Ctrl-click elsewhere keeps selection. */
export function contextPointer(event: { button: number; ctrlKey: boolean }): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey && /Mac|iPhone|iPad|iPod/.test(navigator.platform));
}
