# Masked City Wire HUD Check-Ins

Tampermonkey userscript for Masked City that adds a compact Wire task timer to the game HUD.

## What It Does

- Shows active Wire check-in countdowns in the HUD.
- Tracks how long each check-in has been ready.
- Freezes the delay timer once a check-in is answered.
- Shows overall task progress and remaining task time.
- Displays compact task context: district initial, star count, and district control marker.
- Supports both the classic HUD and the newer `v2-nav` layout.
- Hides automatically on narrow screens.

District markers:

- `🛡️` Hero controlled
- `🏴‍☠️` Villain controlled
- `⚔️` Siege

## Install

This is a userscript, so it requires a userscript manager. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser first, then install the script URL below.

Install with Tampermonkey from:

```text
https://github.com/lvl11evelyn/mc-wiretimers/raw/refs/heads/main/wire-hud-checkins.user.js
```

The script also uses that URL for Tampermonkey update/download metadata.

## How It Works

When a Wire task is active, the script reads the page's `.wb-job` data, stores the task locally, and keeps the HUD timer visible while you move around the site. It uses the Wire board to learn task metadata, and includes a built-in Hero-aligned title-to-star registry to avoid ambiguity when only the active task title is visible.

The roster export button, `⤵️`, copies the known Wire title roster to your clipboard. It includes both built-in Hero-aligned titles and any newly learned titles from future board visits, including villain-side mirrors if the script sees them.

## Built-In Hero Job Registry

This registry is currently based on Hero-aligned Wire content. Villain mirror titles are not included unless learned locally from your own board visits.

### 1★

Bolt Cutters, Petty Theft Call, Porch Pirates, Site Security, Snatch and Run, Till Jumper, Under the Car, Walk-Out

### 2★

Buyer and Seller, Chop Shop, Collection Day, Machine Ripped Out, Night Shift, Robbery in Progress, Second-Story Man, Skimmer Sweep

### 3★

Back Office Job, Dispensary Raid, Hijacked Load, Protection Racket, Smash and Grab, Someone Is Watching, Working the Gala

### 4★

Armored Truck Ambush, Auction House, Bank Siege, Convoy Split, Evidence Room, Penthouse Job, The Count Room, The Loan Exhibit

### 5★

Citywide Blackout, Stop the Train, The Bullion Run, The Crown Job, The Federal Transfer, The Tower Job, War in the Street
