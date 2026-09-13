# Engineering

## Implementation style

- Prefers behavior and values derived from the real asset/data at runtime rather than hardcoded coordinates or assumed conventions — e.g. derive a model's orientation and anatomical landmarks from its actual geometry instead of assuming which axis is up/front/left ("never assume X/Y/Z"). Confidence: 0.55
- Prefers additive changes that leave existing working artifacts untouched — explicitly forbids modifying, regenerating, remodeling, retopologizing or retexturing what already works ("only add"). Confidence: 0.5
- On character/avatar work, treats LEFT/RIGHT as the character's anatomical sides, never the viewer's — a hard rule to apply to any body-region labeling or placement. Confidence: 0.6
- Wants repeated/related elements exposed as independently selectable and editable units, with the content inside each replaceable later (asset/code/text swap) rather than baked in. Confidence: 0.5

## Validation

- Expects results inspected from multiple angles/views and self-corrected before being reported as done (e.g. check front/back/left/right/3-4 views and automatically fix anything floating, clipping or mispositioned). Confidence: 0.5
