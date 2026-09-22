# Product Requirements Document

**Product:** Android music player application (working name: TBD — "our project" throughout this document)
**Version:** 0.1 (Draft, first pass)
**Date:** 2026-09-20
**Status:** Draft for review. **No part of this product is implemented.** This repository contains no application code at the time of writing.
**Owner / decision maker:** TBD
**Document scope:** WHAT the product must do and WHY. Implementation decisions (libraries, modules, playback engine, provider adapters, class design) belong in `ARCHITECTURE.md`, which does not exist yet.

---

## 0. How to read this document

### 0.1 Conventions

| Tag | Meaning |
|---|---|
| **CONFIRMED** | Stated directly as a requirement by the product owner in the project brief. |
| **ASSUMPTION** | Not stated; inferred as probable and **must be validated** before it drives work. |
| **TBD** | Unknown or intentionally undecided. Not a promise. |
| **REFERENCE** | Comes from studying the NØTE repository. Informative only — never a requirement for our product. |

Requirement IDs: `FR` functional, `NFR` non-functional, `PB` playback, `SR` search, `MP` music provider, `SP` stream provider, `BG` background playback, `LB` local library, `EH` error handling, `PF` performance, `RL` reliability, `SEC` security/privacy, `PL` platform, `RSK` provider/licensing risk, `AC` acceptance criteria.

Priority: **MUST** / **SHOULD** / **COULD**. Phase: **MVP** / **Post-MVP**.
A requirement is authoritative; a TBD is explicitly *not* a decision. Anything marked TBD must not be silently resolved by an implementer.

### 0.2 Reference project vs. our project

| | **Our project** | **NØTE (reference only)** |
|---|---|---|
| What it is | A new Android music player, the product of this PRD | A previously studied GitHub repository used as an architectural reference |
| Code | **None written yet** | Exists; not ours |
| Stack | **TBD** | React Native, Expo, TypeScript, Kotlin native Android code (as reported) |
| Audio | **TBD** | `expo-audio` (as reported) |
| Native layer | **TBD** | Custom Expo native modules (as reported) |
| Stream extraction | **TBD — not decided, not endorsed** | NewPipe-Extractor-style extraction for YouTube-related resolution (as reported) |
| Architecture | Must preserve discovery / resolution / playback separation | Reported to separate music provider, stream resolver, and playback |

**Rules carried into this PRD:**

1. Nothing in NØTE is assumed to exist in our project — no code, module, dependency, API, provider, or feature.
2. NØTE's choices are not our defaults. A concept may inform a requirement; it never satisfies one.
3. No implementation is described as existing, working, or planned-with-a-library until a decision is actually recorded.
4. Any overlap between our design and NØTE's must be explained by the requirement it serves, not by "the reference does it".

### 0.3 Explicit non-assumptions

These are things this PRD does **not** assume, and readers must not infer:

- That YouTube, YouTube Music, Instagram, or any other platform offers an official public API that streams arbitrary third-party background audio.
- That the YouTube Data API is an audio-streaming API. It is not treated as one here.
- That any given extraction or scraping approach is officially supported, permitted, or stable.
- That NewPipe Extractor, Media3, ExoPlayer, `expo-audio`, React Native, Expo, or any other library is chosen.
- That Media3 and NewPipe Extractor are the same kind of thing — they are not. Media3 is a device-side playback / media-session framework; an extractor resolves a playable source from a service. See §16.6.
- That any provider capability, quota, rate limit, or catalogue exists. Provider capabilities are TBD until verified against a real provider's terms and documentation.

This document also contains **no instructions for bypassing DRM, authentication, paywalls, anti-bot systems, or any platform access control**. Such techniques are out of scope for the product (see §5 and §24).

### 0.4 Source note on platform and licensing facts

Where this document states a platform or licence fact (e.g. Android foreground-service requirements, a library's licence, Google Play policy wording), the source is listed in Appendix B. Facts about third-party platforms can change; treat them as **verification prompts at decision time**, not as permanent truths.

---

## 1. Product Overview

### 1.1 Summary

We are building a modern Android music player. The product's job is to let a person **find a song and play it with minimal friction**, regardless of where that song actually comes from, and to keep playing it reliably in the background with the polish expected of a production app.

The long-term product covers the full surface of a mainstream music app: Home, Search, Songs, Artists, Albums, Playlists, Recently Played, Liked Songs, Queue, Mini Player, a full Now Playing screen, complete transport controls (play/pause, previous/next, seek, shuffle, repeat), background playback, lock-screen/notification media controls, and a local music library with local history. It additionally explores two link-driven entry points: sharing a YouTube / YouTube Music URL to the app, and sharing an Instagram Reel URL to identify the song used in it and then play that song through a supported music provider.

### 1.2 What exists today

Nothing. This is a fresh project: no application code, no chosen stack, no chosen music provider, no chosen playback engine, no architecture document. Every "how" in this document is either TBD or deliberately deferred.

### 1.3 Product shape (intent)

| Dimension | Intent | Status |
|---|---|---|
| Form factor | Native-feeling Android application, phone-first | CONFIRMED (Android app) |
| UX reference for *feel* | The interaction model and information architecture of YouTube Music | CONFIRMED as inspiration |
| Music source | Provider-agnostic; provider(s) not finalized | CONFIRMED (provider-agnostic intent), TBD (actual provider) |
| Discovery vs playback | Separated: discovery, stream resolution, and playback are distinct concerns | CONFIRMED |
| Distribution channel | TBD — matters a great deal because of §24 | TBD |
| Monetisation | TBD; no ads and no subscription model decided | TBD |
| Account system | TBD; MVP is assumed to require no login | TBD |

### 1.4 Why "provider-agnostic" appears so often

The single largest product risk in this document is that the *online music source* is undecided and may be constrained by licensing, platform policy, or provider terms rather than by engineering. A product whose entire playback path depends on one unsanctioned resolution method has a single point of failure that no amount of code quality fixes. Therefore the requirements below are written so that the **UI never knows where audio comes from**, and so that the **provider can be swapped, reduced, or removed** without a UI rewrite. That is a product requirement (resilience), not a technology preference.

---

## 2. Product Vision

**Vision statement:** *One place to play your music, however you found it.*

A person who discovers a song in a Reel, remembers a track from a YouTube video, and owns a folder of MP3s should not need three apps and two accounts just to **listen**. Our app should accept all of those entry points, resolve each to something playable through a supported source, and present a single consistent player experience on top.

Vision pillars:

1. **Frictionless start.** Open → search → playing in seconds. Once something is playing, the player is always reachable (the mini player never gets lost).
2. **Continuity.** Playback survives screen-off, app-backgrounded, and app-switching. The system's own media surfaces reflect and control our playback.
3. **Honesty.** If a track cannot be played, the user is told why and what to do next — never an endless spinner, never a silent failure.
4. **One interface, many sources.** A user can see where a track came from; the UI is not rebuilt per source.
5. **Growth path.** Queue, liked songs, playlists, local library, and history are natural extensions of the same model, not bolt-ons added later.
6. **Respect for the ecosystem.** We do not build the product on circumvention. Where a platform does not offer a supported way to play its audio, that limitation is a product constraint to design around, not to defeat.

**Quality bar (CONFIRMED):** the end goal is a polished, production-level Android music application — not a demo, not a prototype.

---

## 3. Problem Statement

### 3.1 The problem

A person's music is scattered across sources, and the app they use to *discover* music is usually not the app that holds their library:

1. **Discovery and playback live in different places.** A song found in a short-form video, or in a YouTube video, or saved in a local folder, is not reachable from one place. The user performs manual, error-prone steps (search for the title in another app, hope for a match, lose their place).
2. **Local files are second-class in streaming-first apps.** Music the user already owns is often absent from the discovery surface they actually browse.
3. **Mainstream players are heavy in ways that are not about listening.** Feed-first home screens, ads, upsells, and background-playback paywalls sit between the user and a song.
4. **Background and system integration are treated as premium features.** A music app that stops playing when you lock the screen fails the core job.
5. **Failure states are opaque.** When a track will not play, most apps show a spinner or a generic error, leaving the user to guess whether it is their network, the track, or the app.

### 3.2 Needs left unsatisfied today (ASSUMPTION — validate with user research)

| User need | Typical current experience | Gap our product targets |
|---|---|---|
| "Play the song from this link" | Manual search in another app; often no match | Link → identified track → play, in one flow (Post-MVP, high uncertainty — §24) |
| "Play my own files" | Separate local-player app | Local library alongside online discovery (Post-MVP) |
| "Keep playing with the screen off" | Ads/subscription gates, or unreliable behaviour | Background playback as a first-class MVP requirement |
| "Tell me why it failed" | Generic error or spinner | Explicit, actionable error states (§19) |
| "Let me just listen" | Feature/news/ad clutter | Player-first information architecture |

### 3.3 Why this is worth building now

CONFIRMED direction: a small, sharp MVP (search → play → background) proves the discovery / resolution / playback architecture end to end. If the architecture holds with one narrow provider path, the remaining surface is incremental product work rather than a rewrite. If it does not hold, better to learn that at MVP scope than after building ten screens.

---

## 4. Goals

### 4.1 MVP goals (these define success for the first release)

| ID | Goal | Status |
|---|---|---|
| G-1 | A user can go from opening the app to hearing audio for a searched track in the shortest path the product allows. | CONFIRMED |
| G-2 | Playback continues with the screen off / app backgrounded, without the user re-opening the app. | CONFIRMED |
| G-3 | The playback path is architected so the UI is unaware of the music source (the discovery → resolution → playback separation holds under change). | CONFIRMED |
| G-4 | Every failure in the MVP flow produces a specific, actionable message instead of a spinner or a crash. | ASSUMPTION (derived from the "production-level" bar) |
| G-5 | The MVP stays small enough to finish and keep working: one provider path, one flow, no feature checklist. | CONFIRMED |
| G-6 | The MVP does not depend on an unresolved legal/policy question for its *existence*. | ASSUMPTION — depends on the provider decision (see RSK-01) |

### 4.2 Product goals (post-MVP)

| ID | Goal | Status |
|---|---|---|
| G-7 | A complete listening surface: queue, transport controls, recently played, liked songs. | CONFIRMED as long-term direction |
| G-8 | Local music library integrated with the same track model as online tracks. | CONFIRMED as long-term direction |
| G-9 | Playlists (local-first; any sync behaviour is TBD). | CONFIRMED as long-term direction |
| G-10 | Full system integration: lock-screen / notification controls, correct audio-focus behaviour. | CONFIRMED as long-term direction |
| G-11 | Link-driven entry: YouTube / YouTube Music URL and Instagram Reel URL → identify → play through a supported provider. | CONFIRMED as long-term direction; feasibility and legality TBD |
| G-12 | A Home / discovery surface resembling the reference UX. | CONFIRMED as long-term direction |

### 4.3 Business goals

TBD. Distribution channel, monetisation, and growth targets are undecided, and they interact directly with §24. They cannot be set meaningfully before the provider and distribution questions are answered.

---

## 5. Non-Goals

### 5.1 Non-goals for the MVP (explicit)

These are **out of scope for the MVP**. They are not "maybe later in the sprint"; they are excluded so the MVP can ship.

| # | Not in MVP | Reason |
|---|---|---|
| NG-1 | Queue management, Next / Previous | Listed as Post-MVP by the product owner |
| NG-2 | Shuffle and Repeat | Post-MVP |
| NG-3 | Recently Played, Liked Songs | Post-MVP |
| NG-4 | Local library scanning and playback | Post-MVP (`LB`) |
| NG-5 | Playlists | Post-MVP |
| NG-6 | Lock-screen and notification media controls | Post-MVP by explicit instruction — **but see PL-04: Android may make a media notification a platform requirement of background playback. That is a conflict to resolve, not to ignore.** |
| NG-7 | Home / Artists / Albums / discovery surfaces | Post-MVP |
| NG-8 | Share-URL ingestion (YouTube / Instagram Reel) | Post-MVP; the highest-uncertainty item in this document |
| NG-9 | Accounts, sign-in, cloud sync | Post-MVP unless a chosen provider requires it (TBD) |
| NG-10 | Offline download / caching for later playback | Post-MVP; also intersects licensing (§24) |
| NG-11 | Lyrics, equalizer, audio effects, crossfade | Post-MVP / TBD |
| NG-12 | Android Auto, Wear OS, Android TV, Cast, desktop, iOS | Post-MVP / TBD |
| NG-13 | Social features, sharing, following | Post-MVP / not decided |

### 5.2 Permanent non-goals (not merely deferred)

| # | Never part of this product |
|---|---|
| NG-P1 | Circumventing DRM, authentication, paywalls, geo-restrictions, or anti-bot / access-control systems. |
| NG-P2 | Ripping or downloading audio from a platform whose terms do not permit it, and shipping that as a feature. |
| NG-P3 | Collecting or storing a user's third-party account credentials. |
| NG-P4 | Uploading or redistributing a music catalogue we do not have the rights to. |
| NG-P5 | Becoming a general-purpose media player for non-music content (video consumption, file-manager duties). |

### 5.3 Scope discipline rule

Any addition to the MVP must answer: *which MVP acceptance criterion (§28) does this requirement serve?* If the answer is "none, but it would be nice", it belongs in Post-MVP (§10).

---

## 6. Target Users

Personas below are **hypotheses (ASSUMPTION)** pending research. No user research has been conducted for this project.

### 6.1 Primary personas

| ID | Persona | Situation | Primary need | MVP relevance |
|---|---|---|---|---|
| U-1 | **The searcher** | Wants one specific song right now, title or artist in mind | Type → tap → hear it, fast, without leaving the app | **Primary MVP persona** |
| U-2 | **The background listener** | Listens while commuting, working, screen off, phone in pocket | Audio must not stop; controls must not force re-opening the app | **Primary MVP persona** |
| U-3 | **The link curator** | Saves songs from YouTube / Reels and sends them onwards | Play the song behind a link I already have | Post-MVP (G-11) |
| U-4 | **The local collector** | Owns MP3s/FLACs and expects a player to play them | My files, organised, in the same app | Post-MVP (§18) |
| U-5 | **The library builder** | Wants liked songs, playlists, and history that persist | My stuff stays mine and stays put | Post-MVP |

### 6.2 Characteristics the MVP should assume

- Phone-first, one-handed use, often on the move.
- Intermittent and variable connectivity (mobile data, weak signal, offline tunnels).
- A mix of cheap and mid-range Android devices with aggressive background-process management (OEM battery savers).
- **Headphones / Bluetooth are the default output**, not the phone speaker — this drives the audio-focus and disconnect requirements in §13.
- Limited tolerance for setup friction: no sign-in wall before first playback in MVP.

### 6.3 Explicitly not the target (MVP)

- Users seeking video playback or a general media player.
- Users who want to download/offline-archive third-party catalogues (permanent non-goal NG-P2).
- Users expecting shared/community playlists or social features.
- Desktop, iOS, TV, Wear, and Auto users (Post-MVP).

### 6.4 Device and OS coverage

Minimum supported Android version, device class, RAM floor, and the QA/screenshot matrix: **TBD** (see Open Questions Q-05). The coverage matrix must be decided before MVP code freeze.

---

## 7. Core User Experience

### 7.1 UX principles (normative)

| ID | Principle | Why |
|---|---|---|
| UX-1 | **Search-to-audio is the spine.** Every extra screen between "I want this song" and hearing it is a defect. | U-1's core need |
| UX-2 | **Once something is playing, the player is always reachable** via the mini player, from anywhere in the app. | Prevents losing playback context |
| UX-3 | **Mini player ↔ Now Playing is one predictable expand/collapse action**, and back navigation returns to exactly where the user was. | Android users punish inconsistent back behaviour |
| UX-4 | **No dead ends.** Every error state offers a retry, a back path, or an explanation. | §19 |
| UX-5 | **Loading is visible and bounded.** Skeletons or progress indicators; a spinner that outlives the timeout becomes an error with an action. | EH-02 |
| UX-6 | **Playback state is never ambiguous.** Playing / paused / buffering / error are always visually distinguishable. | Trust |
| UX-7 | **One-hand reachable primary controls.** Core transport controls sit within thumb reach on a typical phone. | Real-world usage |
| UX-8 | **Respect the user's eyes and battery.** No bright full-screen surfaces for audio-only interaction; no needless animation while the screen is off. | Background listener (U-2) |
| UX-9 | **Source is disclosed, never demanded.** Where a track came from may be shown; the user is never asked to understand providers to play a song. | §15 |
| UX-10 | **Do not clone protected assets.** Resembling YouTube Music's interaction model is intended; copying its proprietary logos, artwork, iconography, or copy is not. | §24, RSK-08 |

### 7.2 Surface inventory and phase

| Surface | Purpose | Phase |
|---|---|---|
| Search (input + results) | Find a track | **MVP** |
| Now Playing (basic) | Current track, play/pause, seek, progress, artwork, title/artist | **MVP** |
| Mini Player | Persistent playback access from any screen | **MVP** |
| Error / empty states | Explain and recover | **MVP** |
| Songs, Artists, Albums | Browse catalogue entities | Post-MVP |
| Playlists | User-created lists | Post-MVP |
| Queue | Upcoming, reorderable list | Post-MVP |
| Recently Played | Local history | Post-MVP |
| Liked Songs | Favourites | Post-MVP |
| Local Library | On-device files | Post-MVP |
| Home | Discovery feed | Post-MVP |
| Notification / lock-screen surface | System controls | Post-MVP (with the NG-6 / PL-04 caveat) |

### 7.3 MVP screen-level expectations

**App launch (MVP).** Shows the search entry point without requiring sign-in. If a previous session existed, the last playback state is restored (PB-09). No onboarding flow in MVP unless a permission or provider requirement forces one (TBD).

**Search results list (MVP).** Each row: artwork (with a fallback placeholder), track title, artist name, duration. The whole row is tappable. A loading state appears while results are pending, and superseded queries are abandoned rather than allowed to overwrite newer results (SR-04).

**Now Playing (MVP).** Artwork, title, artist, current position and total duration, seek bar, play/pause. No queue, no shuffle, no repeat in MVP (NG-1, NG-2). Any control that exists must work — misleading placeholder or disabled controls are not acceptable (UX-4).

**Mini Player (MVP).** Visible whenever a track is loaded (playing or paused), persisting across top-level navigation. Shows artwork + title/artist + play/pause, and expands to Now Playing. List content below it receives bottom inset so nothing is permanently hidden.

**Back behaviour (MVP, UX-3).** Back from Now Playing collapses to the previous screen rather than closing the app; back from a list returns to the previous destination; system back never silently kills playback (swipe-away-while-playing behaviour is BG-03 / Q-04).

**Empty and error states (MVP).** No results, no network, unavailable track, and resolution failure each have distinct copy and at least one recovery affordance (§19).

### 7.4 UI/visual direction

Visual style, design system, typography, colour, dark mode, dynamic colour, and iconography: **TBD**, and they belong in a separate design document (with theming details in `ARCHITECTURE.md`). Confirmed intent: modern, polished, player-first. Dark-theme support is **assumed** for a music app (ASSUMPTION). Accessibility basics (§12, NFR-06) are requirements, not design preferences.

---

## 8. Primary User Flows

Notation: each flow lists the triggering action, the observable steps, the success state, and the failure branches with their required handling (the error codes map to §19).

### 8.1 Flow A — Search → play (MVP, the core flow)

| # | Step | System expectation |
|---|---|---|
| A1 | User opens the app | Reaches the search entry point without sign-in or interstitial (launch target §20, PF-01) |
| A2 | User types a query | Input is responsive; the query is issued only after input settles (SR-03, debounce value TBD) |
| A3 | Results appear | Rows show artwork / title / artist / duration (SR-02); a loading state is shown while pending (UX-5) |
| A4 | User taps a result | Track becomes the *selected* track; the UI enters a loading/preparing state for it |
| A5 | System resolves a playable source | A stream resolution happens via the stream provider layer (SP-01) — the UI does not know the source |
| A6 | Playback starts | Audio is heard; Now Playing and the mini player both reflect the track; state = playing (PB-01, PB-02) |
| A7 | User can pause / resume | Transport responds within the interaction budget (PB-03) |
| A8 | User can seek | Position updates and audio continues from the new position (PB-04) |
| A9 | App is backgrounded | Audio continues (BG-01) |

**Failure branches:**

| Branch | Condition | Required behaviour |
|---|---|---|
| A-F1 | No results for the query | Empty state with the query echoed and a suggestion to rephrase (SR-05, EH-08) |
| A-F2 | Search request fails (network / provider) | Specific error + retry (EH-01, EH-03, EH-04) |
| A-F3 | Track cannot be resolved (unavailable, restricted, region-limited) | Explicit "cannot play this track" state with reason category and a back/next option; no automatic retry loop (SP-04, EH-05) |
| A-F4 | Resolution succeeds but playback fails to start | Playback error state with retry; the failed item is not silently skipped (EH-06) |
| A-F5 | Resolution or playback times out | Timeout converts to an error with an action; never an indefinite spinner (EH-02, PF-04) |
| A-F6 | Connectivity lost mid-playback | Buffering indication, then a clear offline error with retry when it cannot recover (EH-01, RL-05) |
| A-F7 | User taps a second result while the first is preparing | The newer selection wins; the stale in-flight operation is abandoned (SR-04, EH-09) |

### 8.2 Flow B — Control playback (MVP)

Trigger: a track is loaded. User may pause, resume, or seek from Now Playing or the mini player. Both surfaces must agree at all times (UX-6).
Success: state changes are reflected within one interaction budget and audio matches the UI (no "UI says playing, audio silent" divergence).
Failure: seek to an unbuffered region shows a buffering state rather than freezing; a seek beyond the streamable range for a partially-available source degrades to a clear error (EH-06).

### 8.3 Flow C — Background playback (MVP)

| # | Step | System expectation |
|---|---|---|
| C1 | Audio is playing; user presses Home / locks the screen / switches apps | Playback continues without interaction (BG-01) |
| C2 | Screen off for an extended period | Audio continues; no wake-lock abuse; no glitch on resume of the display (BG-05, PF-06) |
| C3 | Another app requests audio focus (call, voice note, video) | Our playback yields per platform audio-focus rules — transient loss is recoverable, permanent loss stops playback (PB-06) |
| C4 | Headphones are unplugged / Bluetooth disconnects | Playback pauses rather than blasting the speaker (PB-07) — behaviour on disconnect is a MUST for privacy/comfort, and the exact rule is definite (pause), not TBD |
| C5 | User returns to the app | UI reflects the true current state (playing/paused/position), not a stale snapshot (PB-09) |

**Failure branches:** OEM battery optimiser kills the process (BG-04, RL-04): playback stops; on return, the app must cold-start cleanly into a coherent state rather than a broken one. Audio-focus loss handled wrongly (played over a call) is a **release blocker** class defect.

### 8.4 Flow D — Queue and transport (Post-MVP)

Queue a set of tracks from a list or an album; play; move next/previous within the queue; toggle shuffle; cycle repeat (off / all / one). Enabled by NG-1 and NG-2 becoming in-scope.
Key expectation when it lands: queue state is a first-class part of playback state, survives process death (PB-09), and is consistent between mini player, Now Playing, and the queue surface.

### 8.5 Flow E — Shared YouTube / YouTube Music URL (Post-MVP, feasibility TBD)

| # | Step | Notes |
|---|---|---|
| E1 | User shares a URL from another app to ours | Requires being a share target; URL parsing only (`share` intent) |
| E2 | App identifies the referenced item | Requires reading the URL's identifier; does **not** require any undocumented API |
| E3 | App resolves something playable | **TBD and legally constrained** — see §24. If no supported route exists, the correct product behaviour is an honest "we can't play this here" state, not a silent fallback |
| E4 | Track is matched to a supported provider when possible | Match quality and confidence are TBD (RSK-05) |
| E5 | Playback / or hand-off | TBD |

This flow must not be scheduled into the MVP, and its E3 step must not be committed to a release until RSK-01/RSK-02 are resolved.

### 8.6 Flow F — Shared Instagram Reel URL (Post-MVP, feasibility TBD)

| # | Step | Notes |
|---|---|---|
| F1 | User shares a Reel URL to our app | Requires the app to be a share target |
| F2 | App extracts or derives the audio's song identity | **No official public audio-identification API is assumed.** Any approach (licensed recognition service, platform data, manual user-assisted identification) is TBD, and its legality/cost must be assessed first (RSK-06) |
| F3 | Identified song is matched to the provider catalogue | Requires a provider that actually supports a catalogue lookup |
| F4 | Playback of the matched track | Uses the normal resolution path — this flow adds identification, not a second playback path |

Product rule: identification failure must degrade into a **search pre-filled with whatever was identified** (e.g. a partial artist/title), never into a dead end.

### 8.7 Flow G — Local library playback (Post-MVP)

Scan the device's audio (or user-selected folders) → build a local library → play a local track through the same playback path as online tracks (§18). The UI must not branch on source beyond badges/labels.

### 8.8 Cross-cutting flows (both phases)

| Flow | Trigger | Required product behaviour |
|---|---|---|
| X-1 Process death during playback | OS kills the app while backgrounded | On relaunch the app starts into a coherent state; whether it resumes audio automatically is **TBD** (Q-04). It must never start into a broken or blank player. |
| X-2 Network loss mid-track | Connectivity drop | Buffering UI, then an explicit offline error with retry; position is not silently lost (RL-05) |
| X-3 Resolved source stops working mid-track | A resolved stream becomes invalid/expired | Resolution is refreshed transparently where technically possible; if not, playback error with retry (SP-05, EH-06) |
| X-4 Interruption by a call | Incoming/outgoing call | Pause on audio-focus loss; resume on regain where the platform allows (PB-06) |
| X-5 Permission denial | User denies a permission the app requested | The app stays usable for everything that does not need it; the denied capability is explained, never silently broken (SEC-06, PL-06) |
| X-6 Provider outage or change | Chosen provider is unreachable / changes / breaks | Degrade to a clear "service unavailable" state; never crash, hang, or surface raw errors (MP-06, RL-06) |

---

## 9. MVP Scope

### 9.1 MVP definition

The MVP proves one thing end to end: **a user can search for a song, tap it, hear it, control it, and keep hearing it while the app is backgrounded** — through an architecture in which the UI does not know the audio source.

### 9.2 In scope (MVP)

| Area | Included | IDs |
|---|---|---|
| Launch | Cold start into a usable search/play surface; no sign-in wall | FR-001, PF-01 |
| Search | Query input; results list with artwork / title / artist / duration | FR-010…FR-014, SR-01…SR-05 |
| Selection | Tap a result to play; correct behaviour when selections race | FR-020, FR-021 |
| Resolution | Resolve a playable source for the selected track via the stream-provider layer | FR-030, SP-01…SP-05 |
| Playback | Play, pause, resume, seek, progress display | FR-040…FR-044, PB-01…PB-05 |
| Mini player | Persistent playback access across the app | FR-050…FR-052 |
| Now Playing (basic) | Artwork, title/artist, seek bar, play/pause | FR-060…FR-062 |
| Background playback | Audio continues with screen off / app backgrounded; audio focus handled | FR-070, BG-01…BG-05 |
| Error handling | Every MVP failure branch produces a specific, actionable state | §19 (all `EH-*`) |
| Session continuity | Returning to the app shows true playback state | PB-09 |
| Baseline quality | No crash in the MVP flow, no ANR, accessible interactive controls | §12, §20, §21 |

### 9.3 Out of scope (MVP)

Everything in §5.1 (NG-1 … NG-13). In particular: no queue, no next/previous, no shuffle/repeat, no local library, no playlists, no Home, no history, no liked songs, no lock-screen/notification controls (subject to the PL-04 conflict), no share-target ingestion, no accounts, no offline downloads.

### 9.4 MVP boundary rules

| # | Rule |
|---|---|
| MB-1 | The MVP must work with **exactly one** music provider path. A second provider is Post-MVP even if it is technically easy. |
| MB-2 | Any feature that needs an undecided provider capability (catalogue paging, recommendations, browse) is Post-MVP by definition. |
| MB-3 | No MVP feature may assume a platform permits streaming its audio without an agreement; where that is unknown, the feature is Post-MVP (§24). |
| MB-4 | No MVP feature may require a user account. If the only viable provider demands one, that is a scope-changing decision for the product owner, not an implementation detail. |
| MB-5 | The MVP ships only if §28's acceptance criteria pass on the agreed device matrix. |

### 9.5 MVP critical dependency (needs a product-owner decision)

The MVP flow includes **search** and **resolve a supported playable source**. Both are functions of a music provider. The provider is **not chosen**. Therefore:

> The MVP cannot be delivered until a provider path exists that is (a) technically workable, (b) permitted for the chosen distribution channel, and (c) stable enough to demo twice in a row.

Ways to resolve this are in §15.4; the recommendation is in §15.5. This is the single blocking question in this document (Q-01).

---

## 10. Post-MVP Scope

Ordering below is a **recommendation (ASSUMPTION)**, not a commitment. Sequencing depends on the provider decision.

| Phase | Theme | Contents | Rationale |
|---|---|---|---|
| **P1** | Complete the player | Queue, next/previous, shuffle, repeat, transport polish (FR-045…FR-049) | Cheapest increment; makes the player feel real |
| **P2** | System integration | Lock-screen + notification media controls; interruption handling everywhere | Meets user expectation; also resolves the NG-6 / PL-04 conflict |
| **P3** | Personal library (local-first) | Recently Played, Liked Songs (stored locally) | Persistence layer later phases reuse |
| **P4** | Local library | Device scan, local playback, unified track model | Provider-independent value; no external dependency |
| **P5** | Playlists | Create / edit / reorder / delete; local-only first | Builds directly on P3/P4 data |
| **P6** | Link-driven entry | YouTube / YT Music URL ingestion; Instagram Reel → identify → play | Highest uncertainty and legal exposure; needs its own feasibility and legal gate (§24) |
| **P7** | Discovery surfaces | Home, Artists, Albums, browse views | Depends entirely on provider catalogue capabilities |
| **P8** | Platform expansion | Android Auto, Wear, Cast, widgets | Scope expansion, not core product |

### 10.1 Post-MVP gating rules

- P6 must not start before RSK-01, RSK-02, RSK-05, and RSK-06 are resolved and documented.
- P7 must not be promised in any release plan until the provider's browse capabilities are verified in writing.
- P1–P5 must not be blocked on P6–P7. This is the main reason the local-first phases are scheduled early: they deliver value with no unresolved external dependency.

---

## 11. Functional Requirements

Priority: **MUST** = required for MVP; **SHOULD** = required for MVP unless it is explicitly cut with a written note; **COULD** = Post-MVP candidate.

### 11.1 Application lifecycle

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-001 | The app launches into a usable state without requiring sign-in, onboarding, or network access to render its first screen. | MUST | MVP | CONFIRMED (no account in MVP is ASSUMPTION) |
| FR-002 | The app persists playback state (current track, position, play/pause) across app restarts and process death. | SHOULD | MVP | ASSUMPTION (derived from UX-2/PB-09) |
| FR-003 | The app records recently played tracks locally. | COULD | Post-MVP (P3) | CONFIRMED as long-term |
| FR-004 | The app stores liked tracks locally, with add/remove. | COULD | Post-MVP (P3) | CONFIRMED as long-term |
| FR-005 | The app supports creating and editing playlists. | COULD | Post-MVP (P5) | CONFIRMED as long-term |

### 11.2 Search and results

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-010 | The user can enter a free-text query and receive matching tracks. | MUST | MVP | CONFIRMED |
| FR-011 | Each result row shows artwork, title, artist, and duration; missing fields degrade visibly (placeholder), not blankly. | MUST | MVP | ASSUMPTION (UX completeness) |
| FR-012 | Results are scrollable and remain responsive with large result sets. | MUST | MVP | ASSUMPTION |
| FR-013 | The UI exposes distinct states: idle, loading, results, no results, error. | MUST | MVP | ASSUMPTION (derived from EH-*) |
| FR-014 | A query can be abandoned/replaced without stale results overwriting newer ones. | MUST | MVP | ASSUMPTION (correctness) |
| FR-015 | Search can be repeated from an error state ("retry") without re-typing. | MUST | MVP | ASSUMPTION (UX-4) |
| FR-016 | The user can search their local library (once it exists) with the same interaction. | COULD | Post-MVP (P4) | ASSUMPTION |

### 11.3 Selection and playback of a chosen track

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-020 | Tapping a result selects that track as the current track and initiates playback automatically. | MUST | MVP | CONFIRMED (MVP flow: select a song → play) |
| FR-021 | A newer selection supersedes an in-flight one; only the latest selection may end up as the current track. | MUST | MVP | ASSUMPTION (correctness) |
| FR-030 | The app resolves a playable source for the current track through the stream-provider abstraction, without the UI knowing the source. | MUST | MVP | CONFIRMED (architectural principle) |
| FR-031 | Resolution is per-track and re-usable: the same track object can be resolved again after failure or expiry. | SHOULD | MVP | ASSUMPTION (SP-05) |

### 11.4 Transport controls

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-040 | The user can pause and resume playback. | MUST | MVP | CONFIRMED |
| FR-041 | The user can seek within the current track. | MUST | MVP | CONFIRMED |
| FR-042 | The current position and total duration are displayed and update as playback progresses. | MUST | MVP | CONFIRMED (implied by seek) |
| FR-043 | Playback state (playing / paused / buffering / error) is visible on both Now Playing and the mini player. | MUST | MVP | ASSUMPTION (UX-6) |
| FR-044 | Play/pause and seek are idempotent and safe to spam (no state corruption, no audio/UI divergence). | MUST | MVP | ASSUMPTION (reliability) |
| FR-045 | The user can go to the next / previous track within a queue. | COULD | Post-MVP (P1) | CONFIRMED as long-term |
| FR-046 | The user can toggle shuffle, and the shuffle state is visible. | COULD | Post-MVP (P1) | CONFIRMED as long-term |
| FR-047 | The user can cycle repeat modes (off / all / one), and the mode is visible. | COULD | Post-MVP (P1) | CONFIRMED as long-term |
| FR-048 | The user can view and reorder the queue. | COULD | Post-MVP (P1) | CONFIRMED as long-term |
| FR-049 | Playback volume/ducking behaviour respects system and audio-focus rules. | MUST | MVP | CONFIRMED (PB-06) |

### 11.5 Player surfaces

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-050 | A mini player is visible whenever a track is loaded, on every top-level screen. | MUST | MVP | CONFIRMED |
| FR-051 | The mini player shows artwork, title, artist, and a working play/pause control. | MUST | MVP | ASSUMPTION |
| FR-052 | Tapping the mini player expands to Now Playing; collapsing returns to the previous screen. | MUST | MVP | ASSUMPTION (UX-3) |
| FR-060 | Now Playing shows artwork, title, artist, position, duration, seek bar, play/pause. | MUST | MVP | CONFIRMED (MVP flow) |
| FR-061 | Now Playing does not display controls that do not function in the MVP build. | MUST | MVP | CONFIRMED (UX-4 / scope discipline) |
| FR-062 | Artwork loads asynchronously with a placeholder and never blocks interaction. | MUST | MVP | ASSUMPTION (PF) |
| FR-063 | Now Playing becomes a full, polished surface (queue access, queue-aware transport, metadata completeness). | COULD | Post-MVP (P1) | CONFIRMED as long-term |
| FR-064 | A queue surface exists, showing current and upcoming tracks. | COULD | Post-MVP (P1) | CONFIRMED as long-term |

### 11.6 System and background

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-070 | Audio continues when the app is backgrounded or the screen is off. | MUST | MVP | CONFIRMED |
| FR-071 | Playback is controllable from outside the app (notification / lock screen / Bluetooth / headset buttons). | COULD | Post-MVP (P2) | CONFIRMED as long-term; **see PL-04 for the platform coupling with FR-070** |
| FR-072 | The app is a share target for URLs (receives shared links). | COULD | Post-MVP (P6) | CONFIRMED as long-term |
| FR-073 | The app handles headset unplug / Bluetooth disconnect by pausing. | MUST | MVP | ASSUMPTION (PB-07) — strongly recommended even in MVP |
| FR-074 | The app handles incoming calls and other audio-focus changes correctly. | MUST | MVP | CONFIRMED (PB-06) |

### 11.7 Provider and resolution (functional view)

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-080 | All discovery (search) goes through a music-provider abstraction, never directly from the UI. | MUST | MVP | CONFIRMED |
| FR-081 | All playable-source acquisition goes through a stream-provider abstraction. | MUST | MVP | CONFIRMED |
| FR-082 | Adding a new provider must not require changes to player UI code. | MUST | MVP (design constraint) | CONFIRMED (provider-agnostic intent) |
| FR-083 | The app surfaces "service unavailable" distinctly from "track unavailable" and from "no network". | MUST | MVP | ASSUMPTION (EH taxonomy) |
| FR-084 | Provider identity may be shown to the user as metadata, but must not change the interaction model. | SHOULD | MVP | CONFIRMED (UX-9) |

### 11.8 Library, history, and playlists

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-090 | The app scans the device for audio and presents it as a library. | COULD | Post-MVP (P4) | CONFIRMED as long-term |
| FR-091 | Local and remote tracks share one track model and one playback path. | COULD | Post-MVP (P4) | CONFIRMED (architectural principle) |
| FR-092 | Recently played is recorded and displayed locally. | COULD | Post-MVP (P3) | CONFIRMED as long-term |
| FR-093 | Liked songs can be added/removed and displayed. | COULD | Post-MVP (P3) | CONFIRMED as long-term |
| FR-094 | Playlists can be created, edited, reordered, and deleted. | COULD | Post-MVP (P5) | CONFIRMED as long-term |
| FR-095 | Users can browse by artist and album. | COULD | Post-MVP (P7) | CONFIRMED as long-term |
| FR-096 | A Home surface exists with some form of discovery content. | COULD | Post-MVP (P7) | CONFIRMED as long-term; content source TBD |

### 11.9 Link ingestion (Post-MVP)

| ID | Requirement | Priority | Phase | Status |
|---|---|---|---|---|
| FR-100 | The app accepts a shared YouTube / YouTube Music URL and attempts to identify the referenced track. | COULD | Post-MVP (P6) | CONFIRMED as long-term; feasibility TBD |
| FR-101 | The app accepts a shared Instagram Reel URL and attempts to identify the song used. | COULD | Post-MVP (P6) | CONFIRMED as long-term; **feasibility and legality TBD (RSK-06)** |
| FR-102 | Identified songs are matched to a provider catalogue with a visible confidence/fallback to pre-filled search. | COULD | Post-MVP (P6) | ASSUMPTION |
| FR-103 | If a shared link cannot be played through a supported source, the app says so plainly rather than attempting an unsupported route. | MUST (whenever FR-100/101 exist) | Post-MVP | CONFIRMED (NG-P1) |

### 11.10 Deliverable-completeness rule for requirements

No requirement may be marked done on the basis of "the reference project does it" or "the library provides it". Each is verified against §28 acceptance criteria on a real device, with the actual provider path that will ship.

---

## 12. Non-Functional Requirements

Targets marked **TBD** are placeholders: numbers must be agreed before MVP code freeze, because "fast" and "rarely crashes" cannot be tested.

| ID | Requirement | Target | Priority | Status |
|---|---|---|---|---|
| NFR-01 | Startup: cold start to an interactive first screen | TBD (proposal: < 2 s on mid-range device); warm start < 1 s TBD | MUST | Target TBD |
| NFR-02 | UI responsiveness: no main-thread work that blocks input; sustained scrolling at display refresh rate | 60 fps target, no dropped-frame stutter during scroll | MUST | ASSUMPTION |
| NFR-03 | Network and resolution work never runs on the main thread | No ANR in any MVP flow | MUST | CONFIRMED (basic correctness) |
| NFR-04 | Memory footprint during playback stays bounded; artwork is cached with a size limit and eviction | Ceiling TBD | SHOULD | Target TBD |
| NFR-05 | Battery: no wake locks beyond what playback requires; nothing holds the CPU when paused/idle | Power profile check passes, TBD method | MUST | ASSUMPTION |
| NFR-06 | Accessibility: every interactive control has a content description / label; touch targets meet platform minimum; text scales with system font settings without clipping critical controls; colour is not the sole carrier of state | Compiles and passes manual TalkBack pass over MVP flow | MUST | ASSUMPTION (derived from "production-level") |
| NFR-07 | Localisation: all user-facing strings externalised for translation | No hard-coded user-facing strings | SHOULD | ASSUMPTION |
| NFR-08 | Offline behaviour: opening the app with no network does not crash or hang; core UI renders and errors are explicit | — | MUST | ASSUMPTION |
| NFR-09 | Observability: playback and resolution failures are logged locally in a form that supports debugging without leaking personal data | Log retention/limits TBD | SHOULD | Target TBD |
| NFR-10 | Maintainability: providers and the playback engine are swappable behind defined boundaries (details in `ARCHITECTURE.md`) | No UI file imports a provider implementation directly | MUST | CONFIRMED (architectural principle) |
| NFR-11 | Testability: core logic (state transitions, resolution handling, error mapping) is unit-testable without a device or network | Coverage target TBD | SHOULD | ASSUMPTION |
| NFR-12 | Install/download size | Ceiling TBD | SHOULD | Target TBD |
| NFR-13 | Dark mode and system theme support | Follows system setting | SHOULD | ASSUMPTION |
| NFR-14 | No analytics, telemetry, or crash-reporting SDK ships without an explicit decision and a privacy review | Decision TBD (Q-11) | MUST (if any is added) | TBD |

---

## 13. Playback Requirements

### 13.1 Playback state model (normative)

The player has exactly one current state, at all times, observable by the UI:

`idle → preparing → buffering → playing ⇄ paused → completed | error`

| ID | Requirement |
|---|---|
| PB-01 | The player supports one active track at a time in the MVP. No simultaneous audio streams. |
| PB-02 | Selecting a new track while another is playing transitions cleanly: the previous track's audio stops, and the new track's state becomes authoritative. |
| PB-03 | Play/pause/resume react within one interaction budget (value TBD in `ARCHITECTURE.md`) and are safe to trigger repeatedly. |
| PB-04 | Seek updates position and audio; the UI never shows a position the player disagrees with (except transient, bounded buffering states). |
| PB-05 | Position and duration are reported accurately; a duration that is unknown/unavailable is displayed as unknown rather than as `0:00` or a fabricated value. |

### 13.2 Audio behaviour

| ID | Requirement |
|---|---|
| PB-06 | **Audio focus is respected (MUST).** Transient focus loss (call, notification, navigation prompt) pauses or ducks per platform convention; on regain, playback resumes only if it was playing and the platform permits. Permanent focus loss stops playback and does not resume silently. |
| PB-07 | **Headphone/Bluetooth disconnect pauses playback (MUST).** Audio never auto-switches to the speaker unexpectedly. |
| PB-08 | Playback uses the media audio usage/stream so volume keys behave as users expect, and mixes/ducks consistently with other apps. Exact audio attributes: `ARCHITECTURE.md`. |
| PB-09 | Playback state (track, position, play/pause) survives app backgrounding, rotation, and process death where the platform allows; on return the UI reconciles with the real player state rather than assuming. |
| PB-10 | End of track: MVP behaviour is a defined, non-surprising state (stop and remain paused, or hold at the end). Auto-advance requires a queue and is therefore Post-MVP — MVP behaviour must be **explicitly chosen**, not accidental (Q-03). |
| PB-11 | Buffering is visible and bounded; a stalled stream converts to an error with a retry path (EH-02, PF-04). |
| PB-12 | Audio for a paused player must not continue consuming network bandwidth indefinitely (prefetch policy TBD). |

### 13.3 Not required for MVP (playback)

- Gapless playback, crossfade, audio effects, equalizer (NG-11).
- Variable-speed playback, sleep timer, podcast-style features.
- Casting (NG-12).
- Multi-track queue semantics (NG-1).

### 13.4 Playback engine selection

**TBD — belongs in `ARCHITECTURE.md`.** This PRD does not select a playback engine, and specifically does not assume Media3/ExoPlayer, `expo-audio`, or any other engine. Whichever is chosen must satisfy PB-01…PB-12, and the choice must be recorded with its licence and platform-support implications.

---

## 14. Search and Discovery Requirements

### 14.1 MVP search (normative)

| ID | Requirement |
|---|---|
| SR-01 | The user can enter free-text queries and receive a list of matching tracks from the active music provider. Query semantics (exact, fuzzy, ranking, spelling tolerance) are **the provider's** to define; the product does not promise ranking quality it cannot control. |
| SR-02 | Each result must carry, at minimum: a stable provider-scoped identifier, title, artist (may be empty but must be displayable), duration (may be unknown), and artwork reference (may be absent). |
| SR-03 | Queries are debounced/collapsed so that typing does not fire a request per keystroke (interval TBD in `ARCHITECTURE.md`). |
| SR-04 | Superseded queries are cancelled or ignored: an older response must never overwrite the results of a newer query. |
| SR-05 | Zero results is a first-class state with distinct copy — not an error, and not an empty screen. |
| SR-06 | Result lists are scrollable and must remain smooth with realistic result sizes (size TBD; pagination is **TBD** and depends on the provider). |
| SR-07 | Search must not require the user to choose a provider or source in the MVP UI. |
| SR-08 | Search failures are classified for the user: no network vs. service unavailable vs. provider error (FR-083). |

### 14.2 Post-MVP discovery

| ID | Requirement | Phase |
|---|---|---|
| SR-10 | Search across local library and online provider in one surface, with results attributable to their source. | P4 |
| SR-11 | Search history / recent queries stored locally. | TBD |
| SR-12 | Browse by artist, album, playlist. | P7 |
| SR-13 | Home/discovery content (recommendations, charts, new releases) — **entirely dependent on provider capabilities that are unverified**. | P7, gated |
| SR-14 | Voice search, suggestions/autocomplete. | Not decided (Q-12) |

### 14.3 What is explicitly not promised

- No promise of catalogue completeness. Whatever the provider does not have, the product does not have.
- No promise of matching a user's intent when the provider's catalogue lacks the track (no silent substitution, no auto-picking a "closest" video without telling the user).
- No scraping of search results from a website as a substitute for a provider search capability. If a provider offers no supported search, the product's search requirement is unmet — it does not get "solved" by scraping (NG-P1).

---

## 15. Music Provider Requirements

### 15.1 What a "music provider" is in this product

A **music provider** is the component that supplies *discovery and catalogue data*: it answers "what tracks exist that match this query?" and returns canonical track objects. It does **not** decide how audio is obtained; that is the stream provider's job (§16).

The intended separation (from the project brief, treated as a product-level principle):

```
UI
 ↓
Music Service          (product-level service the UI talks to)
 ↓
Music Provider         (discovery / catalogue implementation)
 ↓
Track                  (canonical product model, source-agnostic)
```

and then, for playback:

```
Track
 ↓
Stream Provider        (resolves a playable source for a track)
 ↓
Resolved Stream        (what the player can actually play)
 ↓
Playback Engine        (device-side audio)
 ↓
Audio
```

The **UI must not care where the music stream comes from** (CONFIRMED). Concretely: no UI code may reference a provider-specific type, URL shape, or error code.

### 15.2 Provider-agnostic requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| MP-01 | The UI consumes a product-level music service, never a provider implementation directly. | MUST | CONFIRMED |
| MP-02 | Providers return a canonical `Track` model. Provider-specific fields (raw IDs, URLs, opaque blobs) may ride along as metadata but must not leak into UI contracts. | MUST | CONFIRMED |
| MP-03 | Each provider declares its own capabilities (e.g. does it support search? browse? albums? artists? playlists?). Features that depend on an unsupported capability must be hidden or explained, never half-working. | MUST | ASSUMPTION |
| MP-04 | Provider selection/registration is a configuration concern, not a UI concern: swapping the MVP provider must not require editing player screens. | MUST | CONFIRMED |
| MP-05 | A provider's identity may be shown as attribution metadata; it must not change the navigation or interaction model (UX-9). | SHOULD | CONFIRMED |
| MP-06 | Provider failures degrade to explicit user-facing states (unavailable / rate-limited / changed behaviour), never to raw exceptions, blank screens, or crashes. | MUST | ASSUMPTION |
| MP-07 | The app must be able to run with a provider that offers only search + track resolution, i.e. without browse/home capabilities. | MUST | CONFIRMED (MVP is search-only) |
| MP-08 | Adding a second provider must be possible without rewriting the music service contract (proving MP-04). Whether it is actually done is Post-MVP. | SHOULD | CONFIRMED |
| MP-09 | No provider may be integrated in a way that requires bypassing access controls, authentication, or platform protections (NG-P1). | MUST | CONFIRMED |
| MP-10 | Provider terms and licensing must be reviewed before integration, and the outcome recorded. An unlicensed provider path is not a viable provider path, however well it works locally. | MUST | CONFIRMED (risk policy) |

### 15.3 Track model (conceptual fields, not an API)

A canonical track must be able to express at least: a stable identifier plus the provider it came from, title, artist(s), album (optional), duration (optional/unknown allowed), artwork reference (optional), and an optional origin hint (e.g. local vs. remote). The concrete model is a design decision for `ARCHITECTURE.md` (**TBD**) — this PRD only fixes the *fields the UI needs* (§11.2, FR-011).

### 15.4 Provider options under consideration (none is chosen)

The table separates the dimensions deliberately, because "it works on my machine" and "we may ship it" are different questions. **Nothing here is a recommendation yet except where explicitly labelled, and none of it is a decision.** Verification is required before any option is adopted (see RSK-* in §24). This document is not legal advice.

| Option | Technical feasibility | Reliability | Official API availability | Licensing | Platform / policy | Distribution |
|---|---|---|---|---|---|---|
| **A. Local device audio** (user's own files) | High — platform-provided media APIs for querying and playing device audio | High (no external service) | Yes — Android platform APIs | The user's own files; no third-party catalogue licence needed | No third-party terms involved; storage/media permissions must be declared correctly | Works in any channel |
| **B. YouTube Data API** | Usable for *metadata/search* only | Depends on Google's API and quota | Yes, official, but it is a **data** API, not an audio streaming API | Google's API terms apply | API terms restrict use of content; the API does not deliver playable audio | Not a solution for MVP playback; may be usable for metadata only, subject to terms |
| **C. YouTube Music as catalogue source** | **Unknown / TBD** | **Unknown** | **No official public API for arbitrary third-party background audio playback is assumed.** Must be verified, not presumed | **TBD** — likely requires an agreement | Consumer product terms; a "client" for the service is not a licensed integration | **TBD** — this is the question the whole product depends on |
| **D. Third-party extraction libraries** (e.g. NewPipe Extractor) | Technically real: such libraries exist and are used by apps in the wild. Their supported-site lists and APIs change with upstream services (the extractor is reported to support YouTube, SoundCloud, media.ccc.de, PeerTube, Bandcamp) | **Low-medium by design** — breaks when the upstream platform changes; requires frequent updates; not a stable contract | Not an official API of any platform; it is an independent scraping/extraction layer | **NewPipe Extractor is GPL-3.0** — copyleft, with real consequences for a non-GPL app, and it pulls in further obligations. Verification required (RSK-03) | Play's Device and Network Abuse policy explicitly prohibits apps that "access or use a service or API in a manner that violates its terms of service" (Appendix B), so an extractor-based app is exposed to removal risk. Extraction is also the exact category our own permanent non-goal NG-P1 excludes | Non-trivial: GPL obligations plus store risk. A GPL-licensed alternative distribution may be possible, but that is a product decision with large consequences |
| **E. Licensed / commercial catalogue provider** | Depends on provider | Potentially high (contractual) | Would be documented, but the provider is **not identified** | Terms and cost **TBD** | Compliant by construction if the agreement permits our use | Depends on the agreement |
| **F. User-provided / openly licensed catalogue** (e.g. Creative Commons or self-hosted sources) | Depends | Depends on the host | **TBD** | Depends on the material | Generally lower risk if licences are respected | Likely easiest to distribute |

**Reading note:** option D is the one most likely to be reached for because it "just works" in a prototype. That is exactly why it is documented with its licensing and distribution consequences attached: technically feasible does **not** mean permitted, stable, or shippable.

### 15.5 Provider decision requirements (what a decision must state)

Before MVP implementation starts, the product owner must record a provider decision that answers all of the following. Until then, provider work is blocked (Q-01).

| # | The decision must state |
|---|---|
| PD-1 | Which provider is the MVP's single provider path (may be option A, a licensed provider, or another verified option). |
| PD-2 | Which distribution channel(s) the app will use, since this determines what is permissible. |
| PD-3 | Whether any agreement, key, quota, account, or credential is required, and who owns it. |
| PD-4 | The licensing position in writing (which licence, which terms, who reviewed it). |
| PD-5 | The fallback behaviour when the provider fails or disappears (the product must degrade, not break). |
| PD-6 | Which provider capabilities (search, browse, artwork, duration) we may rely on for MVP, verified against real responses. |
| PD-7 | Whether the provider requires end-user authentication (which would change scope: MB-4, Q-08). |

**Recommendation (not a decision):** the safest MVP path is one whose playback does not depend on an unresolved third-party question — i.e. build the MVP flow (search → select → resolve → play → background) against the *least* externally-constrained provider available, and treat any catalogue-dependent provider as a second phase. This keeps G-1…G-6 achievable while the provider question is answered, and it exercises exactly the architecture the product needs (MP-01…MP-08, SP-01…SP-06). The product owner must make this call (Q-01/Q-02).

---

## 16. Stream Provider Requirements

### 16.1 What a "stream provider" is in this product

A **stream provider** turns a canonical `Track` into a **Resolved Stream**: something the playback engine can actually play. It is deliberately separate from the music provider: discovery and playback availability are different questions with different failure modes.

### 16.2 Requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| SP-01 | Given a track, the UI-facing layer can request a playable source without knowing how it is obtained. | MUST | CONFIRMED |
| SP-02 | The resolved result must carry enough information for the player to start audio (a playable reference plus any required headers/type hints) and, where available, duration/quality information for display. Concrete shape: `ARCHITECTURE.md` (TBD). | MUST | ASSUMPTION |
| SP-03 | Resolution failures are typed, not generic: unavailable, restricted/region-locked, requires authentication, network failure, provider error, timeout. | MUST | ASSUMPTION |
| SP-04 | Restricted/unavailable content produces an honest user-facing state. The app must not attempt to defeat a restriction (NG-P1). | MUST | CONFIRMED |
| SP-05 | A resolved stream that stops working (including expiry/rotation of a time-limited URL) is either transparently re-resolved or converted into a retryable playback error. | SHOULD | ASSUMPTION |
| SP-06 | Resolution is cancellable and superseded requests do not start playback of a stale track. | MUST | ASSUMPTION |
| SP-07 | The stream layer is replaceable independently of the music provider: a change of playback source must not force a change of discovery source, and vice versa. | MUST | CONFIRMED (architectural principle) |
| SP-08 | The player never receives provider-specific types; it receives the product's resolved-stream model. | MUST | CONFIRMED |
| SP-09 | Local playback is expressible through the same abstraction (a local track resolves to a local playable reference) so local and remote playback share one path (FR-091). | MUST (design) | CONFIRMED as long-term principle |

### 16.3 Reliability expectations specific to resolution

Resolution is the most fragile step in the product because it depends on an external party. Therefore:

- Resolution failures must be **individually diagnosable** in logs (which track, which provider, which failure class, how long it took) without storing user-identifying data (SEC-03).
- A failed resolution must not be silently retried in a loop; retry policy (counts/backoff) is TBD in `ARCHITECTURE.md`.
- A resolution failure must never leave a "ghost" playing state (UI showing playing while nothing plays).

### 16.4 Resolution and the MVP

MVP requires SP-01 through SP-09 to hold for the single chosen provider path. If the chosen provider cannot satisfy SP-04 (i.e. playing it requires defeating a restriction), that provider cannot be the MVP path — this is a hard gate, not a quality preference.

### 16.5 Explicitly not decided here

- Whether resolution happens on-device or via a server/backend of ours. **TBD** (`ARCHITECTURE.md`, Q-06).
- Whether resolved URLs are cached, and for how long. **TBD**.
- Which audio formats/quality tiers are acceptable for MVP. **TBD**.
- Whether the app will ever support user-supplied streams/URLs directly. Not decided (Q-13).

### 16.6 Clarification: Media3 ≠ NewPipe Extractor (and neither is chosen)

These two are routinely conflated. They operate at different layers:

| | Media3 (and ExoPlayer as its playback component) | NewPipe Extractor (or any similar extractor) |
|---|---|---|
| Layer | Device-side playback, media session, media notification, player UI helpers | Service-side data/URL extraction for particular sites |
| Answers the question | "How do I play this audio on Android, and how does the system control it?" | "What playable source does this site's content map to?" |
| Relationship to this PRD | A candidate implementation for the **Playback Engine** (§13.4) | A candidate implementation for the **Stream Provider** (§16) |
| Status in our project | **Not chosen.** TBD. | **Not chosen.** TBD, and gated by RSK-01/RSK-03 and NG-P1. |

Neither library may be referenced in requirements as though it were selected. Selecting either is an `ARCHITECTURE.md` decision plus, for an extractor, a legal/policy gate.

---

## 17. Background Playback Requirements

### 17.1 Requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| BG-01 | Audio continues when the app moves to the background, when the screen is locked, and when the user switches to another app. | MUST | CONFIRMED |
| BG-02 | Background playback must survive normal device state changes (screen off, rotation, entering/leaving the foreground) without gaps, restarts, or position loss. | MUST | ASSUMPTION |
| BG-03 | The user can always stop playback from inside the app. Whether playback stops when the user swipes the app off recents is **TBD** (Q-04); whatever is chosen must be consistent and documented. | MUST | Q-04 TBD |
| BG-04 | Behaviour under aggressive OEM battery management must be defined: if the system kills playback, the app must recover into a coherent state on next launch (X-1). | MUST | ASSUMPTION |
| BG-05 | No unnecessary wake locks, alarms, or timers while paused or idle. | MUST | NFR-05 |
| BG-06 | Playback releases audio focus appropriately when stopped, and does not restart playback the user did not ask for. | MUST | ASSUMPTION |

### 17.2 Platform reality check (informative, and it is a real product constraint)

Android does not let an app keep playing audio indefinitely while backgrounded without meeting platform requirements for running work in the foreground:

- **Foreground service types are mandatory for apps targeting Android 14+**, must be declared in the manifest, and must match the actual use case; a matching permission must be declared, and the app's use of those types must also be declared in the Play Console app-content page (Appendix B).
- For audio playback the relevant documented type is the media-playback type. **The exact manifest/permission wiring is an `ARCHITECTURE.md` task (TBD)** — this PRD deliberately does not specify it.
- Apps target modern Android API levels per Play's target-API requirements (value TBD), so these constraints apply to us.
- Restrictions on *starting* foreground services from the background, and notification permission on recent Android versions, may affect when playback can begin.

**Consequence for the roadmap (PL-04):** lock-screen/notification media controls are listed as Post-MVP (NG-6), but a foreground playback service is normally accompanied by a system media notification. So the MVP may be *technically required* to expose a minimal notification surface even though rich notification controls are Post-MVP. Two acceptable resolutions:

1. **Accept a minimal notification in the MVP** as a platform requirement (no extra features), or
2. **Redefine MVP background playback** as "continues while the app is backgrounded with the screen on / app-switched, but not locked" — which is a weaker product promise.

Option 1 is the recommendation (the promise stays honest); the decision belongs to the product owner (Q-07).

### 17.3 Not required for MVP (background)

- Rich notification actions (next/previous/queue) — Post-MVP (P2).
- Lock-screen artwork/scrubbing parity with a full media session — Post-MVP (P2), though a basic session is likely unavoidable per PL-04.
- Auto-resume after reboot — not decided (Q-14).

---

## 18. Local Library Requirements

Phase: **Post-MVP (P4)**, but its model constrains MVP design — a local track must be expressible as a normal track (FR-091, SP-09).

### 18.1 Requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| LB-01 | The app can discover audio files on the device using platform-provided media APIs, or a user-chosen folder set. Exact mechanism: `ARCHITECTURE.md` (TBD). | MUST (P4) | ASSUMPTION |
| LB-02 | Access to device audio requires the user's permission, requested in context with an explanation, and the app must remain useful when permission is denied (X-5). | MUST (P4) | CONFIRMED (platform requirement) |
| LB-03 | Local tracks are presented with metadata (title/artist/album/artwork where available) and are searchable/browsable like any other track. | SHOULD (P4) | ASSUMPTION |
| LB-04 | The library refreshes incrementally; files added or removed outside the app are reflected without a full rescan each launch. | SHOULD (P4) | ASSUMPTION |
| LB-05 | Missing/unreadable/corrupt local files fail per-track (skippable) and never break the library or the app. | MUST (P4) | ASSUMPTION |
| LB-06 | Local playback uses the same playback path and state model as remote playback (PB-01…PB-12). | MUST (P4) | CONFIRMED (principle) |
| LB-07 | Local library data (index, liked songs, playlists, history) is stored locally and survives app updates. | MUST (P4) | ASSUMPTION |
| LB-08 | The app does not upload, copy, or transmit the user's local files anywhere without an explicit, separate feature decision (see §22). | MUST | CONFIRMED (privacy stance) |
| LB-09 | Local history ("Recently Played") is recorded locally with a bounded size/retention policy (policy TBD). | COULD (P3) | ASSUMPTION |

### 18.2 Why local matters beyond the feature itself

The local library is the only playback source in this document with **no unresolved external dependency**. It gives the product a path to a complete, shippable experience (search → play → background → library → playlists) even while the online-provider question (§24) is being resolved. That is a risk-management benefit, not just a feature.

---

## 19. Error Handling Requirements

### 19.1 Principles

| ID | Principle |
|---|---|
| EH-00a | Every failure has an owner, a message, and a next action. |
| EH-00b | The user is never shown a raw exception, stack trace, HTTP status, or internal identifier. |
| EH-00c | A failure is never silent. If the user asked for audio and gets none, they are told why. |
| EH-00d | The app distinguishes *whose* problem it is — the user's network, the provider's service, the track's availability, or the app itself — because the recovery differs. |
| EH-00e | Failures are bounded: nothing spins forever; every pending operation has a timeout with a defined outcome. |

### 19.2 Error taxonomy and required behaviour

| ID | Condition | User-facing requirement | Recovery affordance |
|---|---|---|---|
| EH-01 | No network / connectivity lost | Explicit offline message; distinguish "you're offline" from "the service is down" | Retry; connectivity is the OS's to fix |
| EH-02 | Operation exceeds timeout (search, resolution, playback start) | Convert to a timed-out state with a message | Retry |
| EH-03 | Provider/service unreachable (server error, DNS, blocked) | "Service unavailable" state, distinct from offline (FR-083) | Retry; keep the UI usable |
| EH-04 | Provider rate-limited / quota exceeded | Explain that the service is temporarily limiting requests | Retry later; no retry storm |
| EH-05 | Track unavailable / restricted / region-locked / requires an entitlement we do not have | Plain statement that this track cannot be played here, with the reason category where known | Return to results; choose another track. **No circumvention attempt** (NG-P1, SP-04) |
| EH-06 | Playback fails after a successful resolution (decode error, stream dropped, unsupported format) | Playback error state naming the track | Retry; if persistent, that track is marked unplayable for the session |
| EH-07 | Resolved source invalidated mid-playback | Attempt transparent recovery; otherwise same as EH-06 | Retry |
| EH-08 | Zero search results | Empty state, not an error; echo the query | Edit the query |
| EH-09 | Superseded/abandoned operation returns late | Ignored, never applied | — (no user-visible effect) |
| EH-10 | Permission denied (once permissions exist) | Explain the specific consequence; the rest of the app keeps working | Link to settings |
| EH-11 | Local file missing/corrupt (P4) | Per-track failure, not a library-wide failure | Skip; remove from index |
| EH-12 | Storage full / write failure for library or history data | Non-blocking warning; playback keeps working | Free space; retry |
| EH-13 | Unsupported content type / live stream | Clear "not supported" message | — |
| EH-14 | Unexpected internal defect | Fail that action, not the whole app; keep playback alive where possible | Retry; log locally (SEC-03) |

### 19.3 Error-handling requirements

| ID | Requirement | Priority |
|---|---|---|
| EH-20 | Error copy is written in product language, is actionable, and is localisable (NFR-07). | MUST |
| EH-21 | The taxonomy above is represented in code as a bounded type/state set, not as free-text strings scattered across the app (`ARCHITECTURE.md`). | MUST |
| EH-22 | A failure during playback must not leave the playback state model (§13.1) in an impossible state. | MUST |
| EH-23 | Any automatic retry is bounded (count/time). Infinite automatic retries are forbidden. | MUST |
| EH-24 | Playback and resolution failures are logged locally with enough context to debug, without PII (SEC-03). | SHOULD |

### 19.4 Forbidden behaviours (release blockers if present)

- Infinite spinner with no timeout.
- Silent failure (nothing happens and nothing is explained).
- Crash or ANR on any MVP flow path, including every failure branch.
- UI reporting "playing" while no audio plays.
- Attempting to bypass a restriction in order to "make it work".

---

## 20. Performance Requirements

The numbers below are **targets to be confirmed** at MVP freeze. They exist so the product can be tested rather than argued about.

| ID | Requirement | Target | Notes |
|---|---|---|---|
| PF-01 | Cold start to interactive first screen | **TBD** (proposal < 2 s on a mid-range device, measured on-device) | Must not wait on network |
| PF-02 | Search: query issued → results rendered | **TBD** (proposal p50 < 1.5 s on a decent connection) | Provider latency is not ours to control; report it with the provider named |
| PF-03 | Tap-to-audio: selecting a track → audible playback | **TBD** (proposal p50 < 2 s) | The single most important perceived-performance metric in the product; includes resolution + buffering |
| PF-04 | Timeout budget: maximum time any operation stays pending before becoming an error | **TBD** (proposal: search 10 s, resolution 15 s) | EH-02 |
| PF-05 | Transport responsiveness: pause/resume/seek feedback | **TBD** (proposal < 100 ms to reflect in UI; audio follows) | PB-03 |
| PF-06 | Battery during 1 hour of background playback | **TBD** (measure, then set a ceiling) | NFR-05 |
| PF-07 | Memory during a 1-hour session with artwork loading | **TBD** (no unbounded growth; cache bounded) | NFR-04 |
| PF-08 | No main-thread network/disk work | Verified by inspection/profiling; no ANR | NFR-03 |
| PF-09 | Scrolling with realistic result counts | No visible jank | NFR-02 |
| PF-10 | Download size (APK/AAB) | **TBD** | NFR-12 |

### 20.1 Measurement requirements

- PF-01, PF-02, PF-03, and PF-05 are measured on **real devices**, in a stated configuration, and the results are recorded in the repository. A documented manual procedure is acceptable for MVP; automation is Post-MVP.
- A latency number is meaningless without the provider and network conditions attached; both must be stated.

---

## 21. Reliability Requirements

| ID | Requirement | Target | Status |
|---|---|---|---|
| RL-01 | Crash-free sessions in the MVP flow | **TBD** (proposal ≥ 99.5% once measurement exists; no crash-reporting SDK is chosen yet — Q-11) | Target TBD |
| RL-02 | Playback start success rate (successful resolutions that actually produce audio) | **TBD** (proposal ≥ 98%, measured per provider) | Target TBD |
| RL-03 | No ANRs | Zero in the MVP flow | MUST |
| RL-04 | Defined behaviour when the OS kills background playback (recover coherently, never crash-loop) | X-1, BG-04 | MUST |
| RL-05 | Network transitions (Wi-Fi ↔ mobile, offline → online) do not require an app restart to recover | Recovery without restart | MUST |
| RL-06 | External dependency drift: when a provider changes behaviour or breaks, the app degrades safely and the failure is diagnosable | Never a silent or catastrophic failure | MUST |
| RL-07 | Updates: state stored locally (liked songs, history, playlists) survives app updates without loss | No data loss | MUST (P3+) |
| RL-08 | Regression safety: the core playback state machine and error mapping have automated tests | Test presence verified at MVP freeze; coverage target TBD | SHOULD |
| RL-09 | Device matrix: the MVP is validated on a stated minimum set of real devices and Android versions | Matrix TBD (Q-05) | MUST |
| RL-10 | Predictable behaviour across OEM skins known to be aggressive with background audio | No unexplained playback death on the tested matrix | SHOULD |

### 21.1 Reliability stance on external dependencies

Because the product's playback path may depend on a third party that can change without notice (RSK-02), reliability requirements RL-06 and RL-01 must be met **without** assuming the dependency is stable. A build that only works "while nothing changes upstream" does not satisfy RL-06.

---

## 22. Security / Privacy Considerations

### 22.1 Data the MVP handles

| Data | Where it lives | Status |
|---|---|---|
| Search queries | In memory / transient; not persisted in MVP unless search history is added (SR-11) | ASSUMPTION |
| Playback state (current track, position) | On device | CONFIRMED (FR-002) |
| Recently played / liked / playlists (P3+) | On device | CONFIRMED as long-term |
| Local library index (P4) | On device | CONFIRMED |
| Provider API keys or credentials, if any | **TBD** — anything secret must not be shipped in an extractable form; a key inside a distributed app is public, so secrets belong behind a server or in a mechanism appropriate to the provider | TBD (SEC-02, Q-05) |
| Account credentials | None in MVP (no account system) | CONFIRMED (no accounts in MVP) |

### 22.2 Requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| SEC-01 | All network communication uses encrypted transport (HTTPS/TLS). No plaintext HTTP endpoints. | MUST | CONFIRMED (baseline) |
| SEC-02 | **No secret is baked into the distributed app.** The handling mechanism is TBD and belongs in `ARCHITECTURE.md`. | MUST | TBD |
| SEC-03 | Diagnostics/logs must not contain user-identifying data, unbounded search history, or any credential. | MUST | ASSUMPTION |
| SEC-04 | The app never asks for or stores credentials for a third-party platform (NG-P3). | MUST | CONFIRMED |
| SEC-05 | Permissions are requested only when needed, in context, with an explanation; no "just in case" permissions. MVP should need few beyond network state and (once background playback exists) notification permission. | MUST | ASSUMPTION |
| SEC-06 | Denial of any permission leaves the app usable and explained (X-5). | MUST | ASSUMPTION |
| SEC-07 | Local data (history, liked songs, playlists) is stored in app-private storage; whether anything needs encryption at rest is a recorded decision (TBD), not an omission. | SHOULD | TBD |
| SEC-08 | No analytics, advertising, or tracking SDK ships without an explicit product decision and a data-safety review (NFR-14). | MUST | TBD (Q-11) |
| SEC-09 | Anything transmitted to a server of ours must be reflected accurately in the store's Data Safety declaration, including retention. | MUST (when applicable) | TBD |
| SEC-10 | The app does not attempt to defeat anti-bot, authentication, or DRM protections (NG-P1) — a policy and security posture together. | MUST | CONFIRMED |
| SEC-11 | Third-party libraries are chosen with licence compatibility in mind, and the licence of every shipped dependency is recorded. | MUST | CONFIRMED |
| SEC-12 | The app does not exfiltrate local files, library contents, or listening history anywhere (LB-08). | MUST | CONFIRMED |

### 22.3 Privacy posture (stated plainly)

The MVP should be able to say truthfully: *no account required, no listening data leaves your device, and nothing is collected unless you opt in.* If a later phase changes that, it is a product decision with a store-listing consequence — not a silent implementation choice.

---

## 23. Platform Constraints

External realities the product must live within. These are constraints, not preferences.

| ID | Constraint | Product consequence |
|---|---|---|
| PL-01 | **Android only, and Android is not one platform.** Behaviour varies by Android version and OEM skin. | NFR-06, RL-09/RL-10: a stated device matrix is mandatory; "works on my phone" is not validation. |
| PL-02 | **Target-API-level requirements** from the store's policies force modern API behaviours on us regardless of our own timeline. | Constrains when features can ship; exact value TBD. |
| PL-03 | **Background audio requires foreground-service machinery** on modern Android: declared and matched service types, a declared matching permission, a Play Console app-content declaration, and restrictions on starting foreground services from the background (Appendix B). | BG-01 is a platform-integration requirement, not "just keep playing". Exact wiring: `ARCHITECTURE.md` (TBD). |
| PL-04 | **A foreground playback service is normally paired with a system media notification.** | The MVP's background playback and the Post-MVP notification controls (NG-6) are coupled; a minimal notification may be required in MVP (Q-07). |
| PL-05 | **Notification permission** on recent Android versions and **media-session/lock-screen integration** are separate concerns with their own APIs. | Affects when and how playback controls can appear; MVP should require the least the platform allows. |
| PL-06 | **Permissions and privacy review:** media/storage access (P4), notification permission, and any data collection require justification, and stores review permissions and data-safety declarations. | SEC-05, SEC-09, LB-02. Any permission added later needs a product reason. |
| PL-07 | **Distribution policy risk.** Play's Device and Network Abuse policy prohibits apps that access a service or API in violation of its terms of service (Appendix B). | Directly constrains provider choice (§15.4 option D). A provider path that violates a platform's terms is a distribution risk, not an engineering trade-off. |
| PL-08 | **Target-API and OS-behaviour changes over time** can break background-playback approaches that previously worked. | RL-06: plan for platform drift, not only provider drift. |
| PL-09 | **Auto / Cast / Wear / TV** each impose additional platform requirements. | Explicitly Post-MVP (NG-12). |
| PL-10 | **Battery optimisers and process death** are the normal case on many OEM devices, not an edge case. | BG-04, X-1, RL-04. |
| PL-11 | **No Android Auto or large-screen parity in MVP;** the app is phone-first. | Scope control. |

### 23.1 Minimum/target SDK, language, and framework

- Minimum and target Android API levels: **TBD** (Q-05) — constrained by provider/library requirements, background-playback APIs, and the chosen device matrix.
- Implementation language, UI toolkit, and module structure: **TBD** (`ARCHITECTURE.md`). Nothing is implied by this PRD — including anything resembling the reference project's stack.

---

## 24. Provider / Licensing Risks

This section exists because the biggest threat to this product is not code quality; it is whether the audio source is permitted, stable, and distributable. The risks are separated by category deliberately, because "technically feasible" and "we can ship this" are not the same claim.

**Scope statement:** this project does not and will not build features that bypass DRM, authentication restrictions, anti-bot systems, paywalls, or platform access controls. Such approaches are product-blocking constraints, not engineering tasks.

### 24.1 Risk register

| ID | Risk | Category | Why it matters | Impact | Mitigation / required action | Status |
|---|---|---|---|---|---|---|
| RSK-01 | **The primary catalogue provider is undecided, and may be unavailable.** No official public API for arbitrary third-party background audio playback from the platform under consideration is assumed. | Provider/API availability + legal | The MVP flow *requires* search plus a playable source | MVP cannot be delivered as specified | PD-1…PD-7 (§15.5); choose a path whose existence does not rest on an unverified assumption; keep the local-library-safe route as the fallback (§18.2) | **Open — blocking (Q-01)** |
| RSK-02 | **A resolved stream can break at any time** (platform changes, token/URL rotation, format changes, throttling). | Technical + reliability | Playback stops working in production with no commit on our side | Users hit failures we cannot reproduce | Never treat resolution as stable: typed failures (SP-03), bounded retry (EH-23), diagnosability (SEC-03), fast update path | Open |
| RSK-03 | **Copyleft licensing trap.** NewPipe Extractor is released under **GPL-3.0** (Appendix B): "you can redistribute and/or modify it under the terms of the GNU General Public License … version 3". | Licensing | Linking it into a non-GPL app creates source-disclosure obligations for the whole app — a one-way door for a closed-source product | Business-model impact | Treat as a **product-owner decision with legal review**, not a dependency pick. Record the licence of every candidate dependency (SEC-11). If GPL is unacceptable, this option is off the table however well it works | Open — legal review required (Q-09) |
| RSK-04 | **Store policy exposure.** Play's Device and Network Abuse policy states it does not allow apps that "access or use a service or API in a manner that violates its terms of service" (Appendix B). | Platform policy + distribution | Removal risk, account risk, and support burden no architecture can absorb | App may not be publishable or maintainable | Decide the distribution channel *with* the provider decision (PD-2); never build the MVP on a path whose terms forbid our use | Open — blocked on PD-2 |
| RSK-05 | **Metadata/artwork licensing.** Catalogue metadata and artwork carry their own rights and platform terms. | Licensing | Even a "working" UI may be using assets impermissibly | Legal exposure; takedown | Confirm provenance and permitted use of every displayed asset; follow each provider's asset rules; document the position | Open |
| RSK-06 | **Instagram Reel → song identification has no assumed official API**, and ingesting a Reel's audio may itself be restricted. | Technical + legal | Flow F (§8.6) is a headline vision feature that may not be implementable as imagined | The vision feature may need reshaping or dropping | Feasibility + legal spike **before** any commitment; keep the honest degradation (pre-filled search); consider a licensed identification service (cost TBD) | Open — Post-MVP gate |
| RSK-07 | **Rate limits, quotas, and cost.** Any provider path may cap requests or cost money at scale. | Provider availability + business | Could change the product's economics or force throttling UX | Design must tolerate being limited | Verify limits in writing before relying on them (PD-3); design graceful degradation (EH-04) | Open |
| RSK-08 | **Reference-project DNA leak.** Adopting NØTE's approach, or YouTube Music's protected assets, without the requirement that justifies it. | Legal + product integrity | Copies a fragile stack we did not choose for our constraints | Rework and avoidable exposure | §0.2 rules apply to every decision; UX-10; similarity must be justified by a requirement | Ongoing |
| RSK-09 | **End-user authentication requirement.** If the viable provider needs the user to sign in, MVP scope changes. | Scope + privacy | A sign-in wall breaks the no-friction promise and adds compliance work | Scope creep | Decide explicitly (MB-4, Q-08); if sign-in is required, the MVP is rewritten deliberately, not quietly | Open |
| RSK-10 | **Platform policy drift on background playback and on extraction.** Rules and OS behaviour change. | Platform + policy | A compliant build today can become non-compliant or broken later | Ongoing maintenance; possible removal | Track policy sources (Appendix B); avoid designs whose only viability is "the rules have not caught up yet" | Ongoing |
| RSK-11 | **False precedent from the reference project.** If NØTE relies on an unsupported extraction path, that is not a precedent for ours. | Legal + governance | "They do it" is neither a licence nor a defence | Bad decisions justified by analogy | Document explicitly that the reference project carries no legal weight for our project | Ongoing |

### 24.2 Four dimensions that must be answered separately for any extraction-based approach

For any candidate that obtains audio from a service rather than through an official API, all four must be answered independently — a "yes" on one does not imply a "yes" on another:

1. **Technical feasibility** — does it work today, and what does it depend on?
2. **Reliability** — how often does it break, and what is the fix latency when it does?
3. **Licensing** — under what licence is the code available, and what obligations does linking it create for our app?
4. **Platform policy and distribution** — does using it violate the source platform's terms, and does that violate the distribution channel's policies?

The product's current hard lines are NG-P1, MP-09, MP-10, SP-04, SEC-10, and PL-07. A candidate that fails any of them is not a candidate.

### 24.3 Risk disposition summary

| If you want to… | Then first resolve |
|---|---|
| Start MVP implementation on the playback path | RSK-01 (provider decision, Q-01) and RSK-04 (distribution, PD-2) |
| Use any third-party extraction approach | RSK-03 (GPL obligations), RSK-04 (policy), and a written legal review (Q-09) |
| Promise the Reel → song flow | RSK-06 (identifiability + legality) and RSK-05 (metadata/artwork rights) |
| Promise "the whole YouTube catalogue" | RSK-01 — that promise cannot be made before a verified, permitted provider path exists |
| Depend on a provider's stability for RL-01/RL-02 | RSK-02 — the target must be reachable with a dependency that can break |

---

## 25. Future Features

Explicitly **not scheduled** and **not promised**. Listed so that the architecture does not accidentally foreclose them, and so that they are visibly separate from scope.

| # | Candidate feature | Notes / dependencies |
|---|---|---|
| F-01 | Accounts and cross-device sync of liked songs, playlists, and history | Requires a backend, privacy review, and a store data-safety update |
| F-02 | Import from another music service (playlists, liked songs) | Depends on that service's export/permission model; legal review |
| F-03 | Offline downloads / caching for later playback | Must only apply to sources whose terms permit it; interacts with RSK-05/RSK-07 |
| F-04 | Lyrics | Licensing of lyrics; provider or third-party source TBD |
| F-05 | Equalizer, audio effects, crossfade, gapless | Device-side; independent of providers — a "safe" feature family |
| F-06 | Sleep timer, playback speed | Device-side; low risk |
| F-07 | Widgets, home-screen shortcuts, quick settings tile | Android surface expansion |
| F-08 | Android Auto, Wear OS, Android TV, Cast | Platform expansion (P8) |
| F-09 | Recommendations / "for you" content | Requires provider capability we do not have; not decidable now |
| F-10 | Collaborative / shared playlists | Requires accounts + backend + legal model |
| F-11 | Podcasts / audiobooks / radio | Different content model; would change the product identity |
| F-12 | Karaoke / lyrics sync | Heavy content licensing |
| F-13 | Desktop / web / iOS | Platform expansion; the architecture's provider separation helps, but nothing is promised |
| F-14 | User-supplied stream URLs (advanced mode) | Not decided (Q-13); would need a policy stance on what users may point the app at |
| F-15 | Listen-together / social listening session | Not decided |
| F-16 | On-device audio fingerprinting to identify a song from the microphone | Different capability from Reel identification; privacy implications |

---

## 26. Success Criteria

### 26.1 MVP success criteria (product)

| ID | Criterion | Measurement | Status |
|---|---|---|---|
| SC-1 | A first-time user can reach audible playback of a searched track without help | Moderated observation of the MVP flow on a real device; target ≥ 9/10 users unaided | ASSUMPTION |
| SC-2 | Playback continues reliably when the app is backgrounded for at least 10 minutes | Manual test on the device matrix | CONFIRMED intent |
| SC-3 | The MVP flow contains zero dead ends: every failure branch shows an actionable state | Review of every branch in §19.2 against §28 | CONFIRMED intent |
| SC-4 | No crash and no ANR on the MVP flow (including failure paths) | Manual + automated test pass; RL-01/RL-03 | CONFIRMED intent |
| SC-5 | The provider-agnostic claim is demonstrable: no UI code references a provider implementation | Code review against MP-01/MP-02/NFR-10 | CONFIRMED intent |

### 26.2 Engineering success criteria

| ID | Criterion | Measurement | Status |
|---|---|---|---|
| SC-6 | Performance targets PF-01…PF-05 are met and measured on real devices | Recorded measurements | Targets TBD |
| SC-7 | The core playback state machine and error mapping have automated tests | Test existence verified; coverage target TBD (RL-08) | SHOULD |
| SC-8 | Every shipped dependency's licence is recorded and compatible with the chosen distribution | Dependency/licence inventory (SEC-11) | MUST |
| SC-9 | The MVP's legal/positioning premises are written down (provider decision, distribution channel, licensing position) | PD-1…PD-7 documented | MUST |

### 26.3 What is deliberately NOT a success criterion

- Number of screens, features, or lines of code.
- Feature parity with YouTube Music or with the reference project. The UX *inspiration* is confirmed; parity is not a goal.
- Catalogue completeness, until a provider makes it measurable.
- Download counts, DAU, retention — no growth model exists yet (§4.3 is TBD).

---

## 27. Open Questions / TBD

Every item below is **undecided**. None may be silently resolved during implementation; each requires a recorded decision (owner: product owner unless stated, all owners currently unassigned).

### 27.1 Blocking questions (MVP cannot be implemented past its skeleton until these are answered)

| ID | Question | Why it blocks | Needed by |
|---|---|---|---|
| Q-01 | **Which music provider is the MVP's single provider path?** | Search and resolution both require it; the whole MVP proof depends on it (RSK-01). | Before MVP implementation begins |
| Q-02 | **Is the MVP's first playable source local-library-based, online-catalogue-based, or another verified option?** | Determines whether the MVP can even exist while the provider question is open (§15.5). | Before MVP implementation begins |
| Q-03 | **What happens at the end of a track in the MVP** (stop paused, hold at end, or something else)? | Auto-advance needs a queue (Post-MVP), so MVP behaviour must be chosen deliberately (PB-10). | Before MVP polish |
| Q-04 | **Does playback stop when the user swipes the app away from recents?** | Affects BG-03, X-1 and user expectation; must be consistent. | Before MVP freeze |
| Q-05 | **Minimum and target Android API levels, and the QA device matrix** (device classes, OEMs, RAM floor)? | Every platform requirement, permission, and performance target is measured against it (PL-01, RL-09). | Before MVP freeze |
| Q-07 | **Is a minimal media notification acceptable in the MVP** to satisfy the platform requirement that accompanies background playback? | NG-6 excludes notification controls, but PL-04 says the platform may require a notification anyway. | Before MVP freeze |

### 27.2 Important but not blocking

| ID | Question | Why it matters |
|---|---|---|
| Q-06 | **Is resolution performed on-device, or via a backend of ours?** | Affects secrecy of credentials (SEC-02), latency (PF-03), reliability (RL-06), and cost (RSK-07). Belongs in `ARCHITECTURE.md`. |
| Q-08 | **Does the chosen provider require end-user authentication?** | A sign-in wall changes MVP scope (MB-4, RSK-09). |
| Q-09 | **Who performs the legal review of provider and dependency licensing, and when?** | RSK-03/RSK-04/RSK-06 cannot be closed without it. |
| Q-10 | **Which distribution channel(s)?** (Play Store, direct APK, F-Droid, other) | Determines what provider/extractor approaches are permissible at all (PD-2, PL-07). |
| Q-11 | **Is any crash-reporting, analytics, or telemetry adopted?** | RL-01 cannot be measured without *something*; every option adds privacy obligations (NFR-14, SEC-08). |
| Q-12 | **Is voice search / autocomplete in scope at all?** | Affects search surface design (SR-14). |
| Q-13 | **Will users ever be allowed to supply their own stream URLs?** | Needs a policy stance about what users may point the app at (F-14). |
| Q-14 | **Should playback resume after device reboot?** | Product expectation question (BG-03 area). |
| Q-15 | **What is the MVP's exact end-of-track and "app killed" recovery promise** (auto-resume or not)? | Interacts with X-1 and Q-04. |
| Q-16 | **Design language, dark mode specifics, and iconography source** | UI delivery (UX-10: do not copy protected assets). |

### 27.3 Technical decisions deliberately deferred to `ARCHITECTURE.md`

Not "TBD because we forgot" — **TBD because they are implementation decisions, and deciding them in the PRD would be premature**:

1. Playback engine / media framework choice (§13.4), and media-session/notification wiring (PL-03, PL-04).
2. Programming language(s), UI toolkit, module/package structure, and minSdk/targetSdk mechanics (Q-05 supplies the values).
3. The concrete `Track`, `Resolved Stream`, provider-capability, and error-type models (their *required fields* are fixed here in §15.3, §16.2, §19.2).
4. Whether a backend exists, and what runs on it (Q-06, SEC-02).
5. Caching/session strategies: artwork cache limits, resolved-URL caching, playback-state persistence mechanism, local-library index storage.
6. Debounce intervals, timeouts, retry counts/backoff, and interaction budgets (values referenced by SR-03, PF-04, PB-03, EH-23).
7. Threading/concurrency model and how cancellable superseded operations are implemented (SR-04, SP-06, EH-09).

### 27.4 Assumptions register (validate or remove)

| # | Assumption | Where it is used | How to validate |
|---|---|---|---|
| A-01 | MVP requires no user account | FR-001, MB-4, §22 | Confirm with Q-01/Q-08 |
| A-02 | Headphones/Bluetooth are the default output | PB-07, §6.2 | Usage observation |
| A-03 | Dark mode is expected | NFR-13 | Design review |
| A-04 | A minimal notification is acceptable in MVP | PL-04, Q-07 | Product decision |
| A-05 | Users tolerate provider-imposed limits (rate limits, unavailability) if explained honestly | EH-04, EH-05 | Usability testing |
| A-06 | Local-library-first is an acceptable risk-mitigation route for MVP | §15.5, §18.2 | Product decision |
| A-07 | The "polished, production-level" bar implies accessibility, error states, and performance targets | NFR-06, §19, §20 | Product confirmation |
| A-08 | The NØTE concepts (provider/resolver/playback separation) are the right separation for us too | §15.1, §16.1 | Architectural review in `ARCHITECTURE.md` |
| A-09 | Direct APK or an alternative store may be acceptable if Play policy blocks a chosen path | RSK-04, Q-10 | Product decision |

---

## 28. MVP Acceptance Criteria

These are the conditions for calling the MVP done. Each is testable on a real device, and each names the requirements it verifies.

**Precondition (gate):** the provider decision (Q-01/Q-02), the distribution channel (Q-10), and the platform/device matrix (Q-05) are recorded before these are run. Without them, AC-02/AC-03 cannot be judged.

### 28.1 Core flow

| ID | Criterion (Given / When / Then) | Verifies |
|---|---|---|
| AC-01 | **Given** a freshly installed app, **when** the user opens it, **then** a usable search entry point appears with no sign-in, no onboarding wall, and no network requirement to render it. | FR-001, PF-01, NFR-08 |
| AC-02 | **Given** a query for a track that exists in the chosen provider, **when** the user types it, **then** matching results appear with artwork or a placeholder, plus title, artist, and duration. | FR-010, FR-011, SR-01, SR-02 |
| AC-03 | **Given** results are shown, **when** the user taps one, **then** audio becomes audible with no further interaction, and both Now Playing and the mini player show that track as playing. | FR-020, FR-030, FR-050, FR-060 |
| AC-04 | **Given** a track is playing, **when** the user pauses and then resumes, **then** audio stops and restarts, and both player surfaces agree with the audio state at every moment. | FR-040, FR-043, PB-03, UX-6 |
| AC-05 | **Given** a track is playing, **when** the user seeks, **then** playback continues from the new position and the displayed position matches the audio. | FR-041, FR-042, PB-04 |
| AC-06 | **Given** a track is playing, **when** the user navigates to any other top-level screen, **then** the mini player stays visible and its play/pause works. | FR-050…FR-052, UX-2 |
| AC-07 | **Given** the mini player is visible, **when** the user taps it, **then** Now Playing opens; **when** the user presses back, **then** the previous screen is restored rather than the app closing. | FR-052, UX-3 |
| AC-08 | **Given** Now Playing is open in the MVP build, **then** no visible control does nothing (no queue, shuffle, or repeat affordances that are not implemented). | FR-061, UX-4 |

### 28.2 Background playback

| ID | Criterion | Verifies |
|---|---|---|
| AC-09 | **Given** audio is playing, **when** the user presses Home and locks the screen for 10 minutes, **then** audio is still playing on unlock. | BG-01, BG-02, SC-2 |
| AC-10 | **Given** audio is playing in the background, **when** the user returns to the app, **then** the UI shows the true current state (playing/paused and position), not a stale snapshot. | PB-09, C5 |
| AC-11 | **Given** audio is playing, **when** an audio-focus interruption occurs (call or another app taking focus), **then** our playback follows the documented rule and never plays over the interruption. | PB-06, FR-074, X-4 |
| AC-12 | **Given** audio is playing through headphones or Bluetooth, **when** the connection ends, **then** playback pauses and does not switch to the speaker. | PB-07, FR-073 |
| AC-13 | **Given** playback is paused or stopped, **when** the app is left idle, **then** no wake lock, timer, or CPU activity keeps the device awake. | BG-05, NFR-05 |

### 28.3 Failure handling (each is a test, not an aspiration)

| ID | Criterion | Verifies |
|---|---|---|
| AC-14 | **Given** the device is offline, **when** the user searches, **then** an explicit offline state with a retry action appears within the timeout budget, with no infinite spinner and no crash. | EH-01, EH-02, PF-04, NFR-08 |
| AC-15 | **Given** the provider is unreachable or erroring, **when** the user searches, **then** a "service unavailable" state appears that is visibly different from the offline state. | EH-03, FR-083 |
| AC-16 | **Given** a track that cannot be played through a supported source, **when** the user selects it, **then** a clear "cannot play this track" state appears with a way back, no unsupported route is attempted, and playback does not enter a fake playing state. | SP-04, EH-05, EH-22, NG-P1 |
| AC-17 | **Given** playback fails mid-track, **then** an error with a retry action is shown, retries are bounded, and the app remains usable. | EH-06, EH-23 |
| AC-18 | **Given** a query with no matches, **then** a distinct empty state appears (not an error) and the user can edit the query. | SR-05, EH-08 |
| AC-19 | **Given** the user changes the query while a request is in flight, **when** the older response arrives late, **then** it does not replace the newer results and does not start playback of a stale track. | SR-04, FR-014, FR-021, SP-06, EH-09 |
| AC-20 | **Given** every failure branch above has been exercised, **then** there is no crash and no ANR. | EH-14, RL-03, §19.4 |

### 28.4 Architecture and quality gates

| ID | Criterion | Verifies |
|---|---|---|
| AC-21 | **Given** the codebase, **when** the player UI code is inspected, **then** no UI file references a provider-specific implementation, type, or error string; providers are reached only through the product-level service. | MP-01, MP-02, MP-04, NFR-10, SC-5 |
| AC-22 | **Given** a stub or second provider implementation, **when** it is substituted, **then** the player UI works unchanged — demonstrated, not asserted. | MP-08, FR-082 |
| AC-23 | **Given** the playback state model, **then** every transition in §13.1 is reachable, no transition produces an impossible state, and the core logic has automated tests. | PB-01…PB-12, EH-22, RL-08 |
| AC-24 | **Given** the shipped app, **then** every dependency's licence is recorded and compatible with the chosen distribution, and no secret is embedded in the build. | SEC-02, SEC-11, SC-8 |
| AC-25 | **Given** the shipped app, **then** every interactive control in the MVP flow has an accessibility label, meets minimum touch-target size, and the flow can be completed with a screen reader. | NFR-06 |
| AC-26 | **Given** the performance targets PF-01…PF-05, **then** measurements are recorded on the agreed device matrix, with the provider and network conditions stated. | PF-01…PF-05, SC-6 |
| AC-27 | **Given** the project's decision log, **then** the provider decision, distribution channel, and licensing position are written down, and every blocking question in §27.1 is either resolved or explicitly accepted as a known gap. | PD-1…PD-7, Q-01…Q-10, SC-9 |

### 28.5 Explicitly out of scope for MVP acceptance

Passing these criteria does **not** require: queue, next/previous, shuffle, repeat, recently played, liked songs, playlists, local library, Home/Artists/Albums, share-link ingestion, accounts, offline downloads, or rich notification controls (NG-1…NG-13). An MVP build that satisfies AC-01…AC-27 and none of those is a legitimate, complete MVP.

### 28.6 Definition of done (summary)

The MVP is done when: **AC-01…AC-27 pass on the agreed device matrix**, the provider/platform/licensing preconditions are written down, and the failure branches in §19.2 are demonstrated live rather than assumed to work.

---

## Appendix A — Glossary

| Term | Meaning in this document |
|---|---|
| **Music provider** | Supplies discovery/catalogue data and canonical track objects (§15). |
| **Music service** | The product-level service the UI talks to; hides which provider is active. |
| **Track** | The canonical, source-agnostic product model for a piece of music (fields in §15.3). |
| **Stream provider** | Turns a Track into a playable source (§16). |
| **Resolved stream** | The playable result of resolution — what the playback engine can consume. |
| **Playback engine** | The device-side component that produces audio (choice TBD, §13.4). |
| **Media session** | The platform concept that exposes playback to system media surfaces; wiring TBD (PL-03/PL-05). |
| **Extractor / extraction layer** | A library that derives playable sources from a service's content rather than from an official API (§24.2). Not endorsed, not selected. |
| **Foreground service** | The Android mechanism that allows work (e.g. audio playback) to continue while the app is not in the foreground (PL-03). |
| **MVP** | The scope in §9: search → select → resolve → play → pause/seek → mini player → background playback. |
| **Post-MVP** | Phases P1…P8 (§10). |
| **Confidence tags** | CONFIRMED / ASSUMPTION / TBD / REFERENCE (§0.1). |

---

## Appendix B — Sources for platform, policy, and licence facts

Facts marked as sourced in this document come from the following. Each is a **verification prompt**, not a permanent truth — re-check at decision time.

| Fact stated in this PRD | Source |
|---|---|
| NewPipe Extractor is licensed GPL-3.0 ("Free Software … under the terms of the GNU General Public License … version 3"); its supported-site list includes YouTube, SoundCloud, media.ccc.de, PeerTube, Bandcamp; it is described as a core component of NewPipe but usable independently | `https://github.com/TeamNewPipe/NewPipeExtractor/` (README + licence shown by GitHub) |
| Apps targeting Android 14+ must declare foreground service types, declare the matching permission, and declare their foreground service types in Play Console (Policy → App content); the platform documents each type with its permission and runtime prerequisites | Android Developers: "Foreground service types are required" and "Foreground service types" |
| Google Play prohibits apps that "access or use a service or API in a manner that violates its terms of service", and apps in the Device and Network Abuse category generally (unauthorised access/interference with services, APIs, or networks) | Play Console Help: "Device and Network Abuse" (Privacy, Deception and Device Abuse) |
| The YouTube API Services Terms of Service is a legal agreement governing use of `YouTube API Services`, defined to include the YouTube Data API service and API Data (audiovisual content and information provided through the API); compliance is mandatory and breaches can lead to access being limited or terminated | `https://developers.google.com/youtube/terms/api-services-terms-of-service` |

Note on interpretation: the documents above do **not** grant a licence to stream arbitrary audio outside the platforms' own clients, and this PRD does not infer one from them. They are cited to support the *constraints* described in §15.4, §23, and §24.
