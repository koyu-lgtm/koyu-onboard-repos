# koyu-onboard-repos

Reference files for the LIBERO+ACT eval rig onboarding. The flow lives at
https://koyu.dev/onboard — this repo just carries the rig-specific code so
the agent applies files instead of generating them. Every file here is
yours to rewrite; the runtime's boot typecheck will name anything you get
wrong.

## Files

| file | apply to |
|---|---|
| `types.py.append` | append to `koyu-runtime/koyu_runtime/ipc/types.py` |
| `data_recorder.sources.py` | replace `SOURCES = []` in `koyu_runtime/services/data_recorder.py` |
| `services.yaml.template` | substitute placeholders → `$KOYU_RUNTIME/services.yaml` |
| `ControlsPage.tsx` | replace the stub at `frontend/src/features/controls/pages/ControlsPage.tsx` |
| `index.css.append` | append to `frontend/src/index.css` |

`ControlsPage.tsx` needs no edits: provenance is read live from the
runtime's `recording-context.json` (via the bridge `/context` endpoint
through the vite `/bridge` proxy) — the same context your episodes are
stamped with.

## Placeholders (services.yaml only)

`koyu clone` prints id remaps; use the LOCAL ids:

`{{VENV_PYTHON}}` · `{{ACT_PROJECT_DIR}}` · `{{ACT_RUN_DIR}}` ·
`{{LIBERO_PROJECT_DIR}}` · `{{RUNTIME_DIR}}` · `{{CLONED_PROJECT_ID}}` ·
`{{CLONED_RUN_ID}}`

## Dependency pins (one venv)

```
torch==2.7.* torchvision>=0.22,<0.23 torchcodec==0.3.* einops
transformers==5.13.* hf-libero>=0.1.4 pyyaml pyarrow
cmake==3.31.* numba>=0.59        # build/3.12 compat — do not let these float
```
