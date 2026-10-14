import { Sparkles } from 'lucide-react';

/** One setting surface, reused on the project page and from the board. */
export default function ProjectSettings({ enabled, busy, onChange }: {
  enabled: boolean; busy: boolean; onChange: (enabled: boolean) => void;
}) {
  return <section className="project-settings" aria-label="Project settings">
    <h2>Settings</h2>
    <label className="project-settings__row" htmlFor="clip-project-setting">
      <Sparkles size={20} aria-hidden="true" />
      <div><strong>Content matching <span>CLIP</span></strong><p>Find images with similar subjects.</p></div>
      <input id="clip-project-setting" type="checkbox" role="switch" aria-label="CLIP content matching" checked={enabled} disabled={busy} onChange={event => onChange(event.target.checked)} />
    </label>
    <p className="project-settings__detail">First use downloads about 75 MB. Images are processed on this device.</p>
  </section>;
}
