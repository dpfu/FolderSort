export function PileOrderOptions({ clipEnabled = true }: { clipEnabled?: boolean }) {
  return <>
    <option value="random">Random</option>
    <option value="similarity">Visual similarity</option>
    {clipEnabled && <option value="semantic">Content similarity</option>}
    <option value="modified">File modified · oldest first</option>
    <option value="bytes">File size · largest first</option>
    <option value="resolution">Resolution · largest first</option>
    <option value="aspect">Shape · portrait to landscape</option>
    <option value="name">Filename · A–Z</option>
  </>;
}
