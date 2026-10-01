import { useSettings } from './SettingsContext.jsx';
import PixelArrow from './PixelArrow.jsx';

// Options screen, grouped into Visual and Audio sections. Each option is one
// ToggleRow; add future ones to the right section here alongside a new key
// in SettingsContext.jsx's DEFAULT_SETTINGS.

export default function Settings({ onBack }) {
  const { settings, setSetting } = useSettings();

  return (
    <div className="app-shell">
      <div className="page-head">
        <h1>Settings</h1>
        <button type="button" className="text-btn" onClick={onBack}>
          <PixelArrow direction="left" unit={2} className="back-arrow" />
          Back
        </button>
      </div>

      <section className="settings-section pixel-frame" aria-labelledby="settings-visual">
        <h2 id="settings-visual">Visual</h2>
        <ToggleRow
          id="setting-stamp-text"
          label="Stamp text"
          description="Headlines and results animate on letter by letter."
          checked={settings.stampText}
          onChange={(value) => setSetting('stampText', value)}
        />
        <ToggleRow
          id="setting-page-rock"
          label="Page rocking"
          description="Newspaper pages sway gently back and forth."
          checked={settings.pageRock}
          onChange={(value) => setSetting('pageRock', value)}
        />
      </section>

      <section className="settings-section pixel-frame" aria-labelledby="settings-audio">
        <h2 id="settings-audio">Audio</h2>
        {/* No sound in the game yet; audio toggles go here once there is. */}
        <p className="setting-description">Sound options coming soon.</p>
      </section>
    </div>
  );
}

function ToggleRow({ id, label, description, checked, onChange }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <label className="setting-label" htmlFor={id}>{label}</label>
        <p className="setting-description">{description}</p>
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        className={['setting-toggle', checked && 'is-on'].filter(Boolean).join(' ')}
        onClick={() => onChange(!checked)}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}
