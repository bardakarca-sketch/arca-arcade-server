---
name: faceless-video-playbook
description: Use when planning, scripting, or reviewing faceless short-form videos (TikTok, YouTube Shorts, Reels) — 3D what-if, "how it's built" cutaways, survival stories, long-form explainers — or when the user asks for video ideas, a video script, or whether a video is ready to post. Pairs with the moneyprinterturbo-video skill and the tools/pool-3d renderer. Uses Claude as the only LLM.
---

# Faceless Video Playbook

Guidance distilled (in our own words) from "The Faceless 3D Playbook" the user shared, plus lessons from videos made in this repo. The user speaks Turkish: talk to them in Turkish, write scripts in Turkish unless they ask otherwise.

## LLM rule

Use Claude only (Anthropic API key from the `ANTHROPIC_API_KEY` environment variable, or Claude itself in this session). Do not use OpenAI/GPT or fal. Never ask for keys in chat.

## Formats

1. **What-if (3D):** one everyday thing changes for a few seconds in a famous, sunny, crowded place; consequences stack up to an ending people argue about. Strongest performer.
2. **How it's built (cutaway):** a dream project (pool, bunker, shelter) shown in cross-section from empty ground to finished reveal. Every shot is further along.
3. **Survival story:** day-by-day choices with a day counter; each episode can end on the next day (Part 2 hook).
4. **Long-form journey:** the same question stretched to 5–8 minutes as an escalating ladder with a clock on screen.

All four share: a one-second question, a recognizable place, something new every few seconds, a payoff worth commenting on.

## Seven idea rules

1. Change one everyday thing; if the premise needs a second sentence, it is too complicated.
2. Put it somewhere bright, busy and well known; dark/space scenes underperform.
3. Mine the comments for the next idea.
4. Something new every 2–3 seconds, plus an on-screen number that keeps moving (counter).
5. A recurring line or running joke for regulars — vary it, don't repeat the video.
6. Write for one audience/country (units, places, currency) and stay consistent.
7. The idea beats the polish. One-line test: if a friend asks "wait, then what happens?", it's a video.

## Story structure that worked here (user feedback)

- Build **problem → solution** step by step: start with the naive version, show what goes wrong, add the fix, repeat (e.g. hole + water → leaks → concrete → green water → filter → germs → chlorine → cold/dark → heater + lights → reveal).
- Show it, don't just say it: labels on equipment, x-ray pipes with flowing particles, live counters (depth, tons, clarity %, °C).
- Grounded setting (flat neighborhood with houses, street, cars) beats a floating diorama.
- Captions must be word-synced to the voice: use TTS word boundaries or Whisper word timestamps, never proportional guesses.
- The user disliked all free TTS voices; prefer their own recorded narration (cut count-ins, denoise, loudness-normalize, align with faster-whisper; see `tools/pool-3d/audio_user.py`).

## Money and length

- Plan 61–80 seconds from the first draft (short platforms often pay only above one minute); the extra time must be story, not padding.
- Bonus-rate payouts favor searchable "real knowledge" questions and longer watch time. Views and income are never guaranteed — say so.

## Mistakes that get videos flagged

1. Uploading the same file twice (even if an upload looks stuck — check the profile first).
2. Copying someone else's script word for word — copy format and pacing, write your own words.
3. Reusing your own sets, openings, endings and camera paths across videos.
4. Popular free music beds — build original sound per video.
5. Videos under ~61 seconds when monetization matters.
6. Accounts that look like another account (name, picture, bio).
7. Judging or deleting too early — wait ~24 hours; look at views per hour and like rate.

## Pre-post checklist

- [ ] Longer than 61 seconds?
- [ ] New place, new opening, new camera path?
- [ ] Every word of the script is ours?
- [ ] This exact file has never been posted anywhere?
- [ ] Captions synced to the voice; counter on screen; ending invites comments?

## Tools in this repo

- `.claude/skills/moneyprinterturbo-video/` — stock-footage videos (Claude as LLM, Pexels key needed).
- `tools/pool-3d/` — three.js cutaway renderer (scene `web/index.html`, `audio.py` for TTS, `audio_user.py` for the user's own voice, `capture.js` renders frames via headless Chromium + ffmpeg).
- `tools/chat-video/` — phone-chat style renderer.
