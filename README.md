# Train & Fuel

Personal workout and food accountability app. Runs on GitHub Pages; no build step.

- **Today / Food / Train / Trends**: calories against a ±200 kcal band, protein/fat/carb ranges, water, kitchen hours, flex day, weekly score, streak, weigh-ins, PRs.
- **Coach**: an ElevenLabs agent (voice or text) that sees today's log, the week's routine, recent days, About me and learned notes, and can log meals, workouts, water and weigh-ins.
- **Data**: lives in a separate **private** repo (`train-and-fuel-data`). Each device connects once with a fine-grained GitHub token (Contents: read & write on that repo only), stored in that browser's localStorage. Nothing personal is in this repo.

## Files
- `index.html`: the whole app (HTML, CSS, JS)
- `vendor/elevenlabs-client-1.28.0.js`: ElevenLabs JS SDK (IIFE build, MIT), pinned
- `manifest.webmanifest`, icons: add-to-home-screen support

## Data repo layout
- `profile.json`: settings (targets, routine, About me, coaching style, quick prompts), memory notes, saved meals, history, weigh-ins
- `log/YYYY-MM.json`: meals, workouts, water for that month
- `chat.json`: recent Coach conversation
- `checkins/latest.md` and `checkins/YYYY-MM-DD.md`: Sunday check-ins

## Coach agent
ElevenLabs agent `agent_7601m6j5ksxtfg59e823qjgjz6cc`, locked to `rjivraj72-ops.github.io`. All app data reaches it through the `{{context}}` dynamic variable at session start; logging happens through client tools (`log_meal`, `log_workout`, `log_water`, `log_weight`, `delete_entry`, `remember_about_me`, `get_days`).
