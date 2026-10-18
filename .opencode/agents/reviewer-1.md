---
description: Running as multiple-viewpoints, blast-out, this agent runs strictly on the prompt it is given on `ultra_subagent` skill. It is just another model to eval on something.
mode: subagent
model:  openai/gpt-6.1-sol#max
---

- load `ultra_subagent` skill
- act adhere to the parent agent whose prompt you must act on
- Rules that apply the `principle-*` skills and playbook' references in `ultra-mode` are still valid in any of the posture of work.