import {
  getPresetProvidersByGroup,
  type PresetProvider
} from "./model-settings-controller";

type PresetProviderSectionsProps = {
  codingPlanTitle?: string;
  disabled?: boolean;
  officialTitle: string;
  onSelect: (preset: PresetProvider) => void;
  selectedPresetId?: string;
};

type PresetQuickSetupProps = {
  disabled?: boolean;
  modelLabel: string;
  onModelSelect: (modelValue: string) => void;
  preset: PresetProvider;
  selectedModelValue?: string;
};

function PresetProviderButton({
  disabled,
  onSelect,
  preset,
  selected
}: {
  disabled?: boolean;
  onSelect: (preset: PresetProvider) => void;
  preset: PresetProvider;
  selected?: boolean;
}) {
  return (
    <button
      className={`model-source-item preset ${preset.group === "coding-plan" ? "coding-plan" : ""} ${selected ? "selected" : ""}`}
      disabled={disabled}
      key={preset.id}
      onClick={() => onSelect(preset)}
      type="button"
    >
      <span className="model-profile-icon" style={{ background: preset.accentColor }}>
        {preset.iconLabel}
      </span>
      <span className="model-source-item-copy">
        <strong>{preset.name}</strong>
        <small>{preset.description}</small>
      </span>
    </button>
  );
}

export function PresetProviderSections({
  codingPlanTitle = "Coding Plan",
  disabled,
  officialTitle,
  onSelect,
  selectedPresetId
}: PresetProviderSectionsProps) {
  const officialPresetProviders = getPresetProvidersByGroup("official");
  const codingPlanProviders = getPresetProvidersByGroup("coding-plan");

  return (
    <>
      <div className="model-source-section">
        <div className="model-source-section-title">
          <h4>{officialTitle}</h4>
        </div>
        <div className="model-source-list">
          {officialPresetProviders.map((preset) => (
            <PresetProviderButton
              disabled={disabled}
              key={preset.id}
              onSelect={onSelect}
              preset={preset}
              selected={selectedPresetId === preset.id}
            />
          ))}
        </div>
      </div>

      <div className="model-source-section">
        <div className="model-source-section-title">
          <h4>{codingPlanTitle}</h4>
        </div>
        <div className="model-source-list">
          {codingPlanProviders.map((preset) => (
            <PresetProviderButton
              disabled={disabled}
              key={preset.id}
              onSelect={onSelect}
              preset={preset}
              selected={selectedPresetId === preset.id}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function PresetQuickSetup({
  disabled,
  modelLabel,
  onModelSelect,
  preset,
  selectedModelValue
}: PresetQuickSetupProps) {
  return (
    <div className="preset-quick-setup">
      <div className="preset-quick-setup-header">
        <span className="preset-provider-icon small" style={{ background: preset.accentColor }}>
          {preset.iconLabel}
        </span>
        <div>
          <strong>{preset.name}</strong>
          <p>{preset.description}</p>
        </div>
      </div>
      {preset.modelSuggestions.length > 0 ? (
        <div className="preset-model-suggestions">
          <span>{modelLabel}</span>
          <div className="preset-model-chips">
            {preset.modelSuggestions.map((model) => (
              <button
                className={`preset-model-chip ${selectedModelValue === model.value ? "selected" : ""}`}
                disabled={disabled}
                key={model.value}
                onClick={() => onModelSelect(model.value)}
                type="button"
              >
                {model.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
