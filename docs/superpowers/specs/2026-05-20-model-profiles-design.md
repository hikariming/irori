# Model Profiles Design

## Goal

Replace the single model provider setting with multiple model profiles and a global `activeModelId`, so the desktop app can save several OpenAI-compatible model connections and switch the active one without rewriting downstream chat, memory, or tool code.

## Scope

This is a model profile manager, not a provider marketplace. The first version supports OpenAI-compatible chat completion endpoints. It saves multiple complete profiles, switches one active profile globally, tests the active or edited profile, and keeps the existing local-agent route unchanged.

## Profile Model

Each profile stores:

- `id`: stable local identifier.
- `name`: user-facing label such as `OpenAI GPT-5.2` or `智谱 GLM-5.1`.
- `baseUrl`: normalized OpenAI-compatible base URL.
- `modelName`: request body model name.
- `hasToken` and `tokenHint`: safe UI snapshot fields.

The persisted file also stores `activeModelId`. Tokens remain per profile in the persisted Tauri settings file, but frontend snapshots never expose raw token values.

## Backward Compatibility

Existing `model-settings.json` files with the old `{ baseUrl, modelName, token }` shape are read as one default profile. The profile becomes active automatically. Saving after that writes the new `{ activeModelId, profiles }` shape.

## Global State

`ModelSettingsState` becomes the shared model registry state:

- `activeModelId`
- `profiles`
- derived active profile helper

The app-level state in `App.tsx` remains the source of truth for whether chat can send. `isModelConfigured` checks the active profile for base URL, model name, and saved token. Future screens can switch models by updating `activeModelId` through the same state shape.

## Settings UI

The existing `模型供应商` tab becomes `模型接入`. The panel shows the saved profiles and an editor for the selected profile. Expected controls:

- Select an existing profile.
- Add a profile.
- Rename or edit endpoint/model fields.
- Save the edited profile.
- Test the edited profile.
- Set the selected profile as active.
- Delete a non-last profile.

The active profile is visually marked, and the route preview always reflects the currently edited profile.

## Runtime Flow

Tauri exposes profile-aware commands while preserving the current local-agent payload shape:

- `get_model_settings` returns the profile registry snapshot.
- `save_model_settings` saves or updates a profile and can set it active.
- `set_active_model_profile` switches `activeModelId`.
- `delete_model_profile` removes a profile when at least one profile remains.
- `test_model_connection` tests the active profile unless a draft profile is explicitly supplied.

`send_pi_prompt` resolves the active stored profile, injects its token, and passes a single `{ baseUrl, modelName }` object into local-agent. local-agent continues to resolve one OpenAI-compatible model per run.

## Error Handling

If no active profile exists, the first configured profile becomes active. If the active profile is missing a token, chat remains disabled and the settings panel opens as it does today. Invalid profile edits keep the panel usable and show compact save/test errors.

## Testing

Add focused tests before implementation:

- Model settings controller migrates legacy single-model snapshots into one active profile.
- Active profile helpers return the selected profile and configuration readiness.
- Saving a profile preserves existing token when the token field is left blank.
- Switching `activeModelId` changes route preview and chat readiness.
- Deleting the active profile selects a remaining profile.
- local-agent resolver still maps the active profile to the same OpenAI-compatible custom model.
