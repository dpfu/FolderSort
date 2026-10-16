export function formatDurationLabel(durationSec: number | undefined) {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec < 0) return '';
  const rounded = Math.max(0, Math.round(durationSec));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
