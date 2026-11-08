---
version: alpha
name: Lookup playful learning
description: Duolingo-inspired tactile learning UI with original book and check artwork, truthful feedback, and accessible dark labels.
colors:
  primary: "#58CC02"
  on-primary: "#234600"
  primary-edge: "#46A302"
  secondary: "#1CB0F6"
  on-secondary: "#073B56"
  secondary-edge: "#1489C1"
  secondary-soft: "#E5F6FF"
  background: "#FFFFFF"
  surface: "#F7F7F7"
  text: "#3C3C3C"
  muted: "#616161"
  border: "#E5E5E5"
  success-surface: "#EFFBDD"
  error-surface: "#FFF0EF"
  error: "#A12525"
  focus: "#0969A2"
  disabled: "#EDEFF0"
  disabled-edge: "#C6CBCE"
typography:
  heading:
    fontFamily: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif'
    fontSize: 32px
    fontWeight: 800
    letterSpacing: -0.02em
  expression:
    fontFamily: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif'
    fontSize: 40px
    fontWeight: 800
    letterSpacing: -0.02em
  body:
    fontFamily: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif'
    fontSize: 16px
    fontWeight: 500
  label:
    fontFamily: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif'
    fontSize: 15px
    fontWeight: 800
rounded:
  control: 16px
  card: 24px
  badge: 12px
spacing:
  small: 8px
  medium: 16px
  large: 24px
  section: 32px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  caption:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted}"
  heading:
    textColor: "{colors.text}"
    typography: "{typography.heading}"
  expression:
    textColor: "{colors.text}"
    typography: "{typography.expression}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.medium}"
    height: 52px
  button-primary-edge:
    backgroundColor: "{colors.primary-edge}"
    height: 4px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
  button-secondary-edge:
    backgroundColor: "{colors.secondary-edge}"
    height: 4px
  navigation-selected:
    backgroundColor: "{colors.secondary-soft}"
    textColor: "{colors.on-secondary}"
    rounded: "{rounded.control}"
  card:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "{spacing.large}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  outline:
    backgroundColor: "{colors.border}"
    height: 2px
  feedback-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
  feedback-error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.control}"
  focus-ring:
    textColor: "{colors.focus}"
    size: 3px
  button-disabled:
    backgroundColor: "{colors.disabled}"
    textColor: "{colors.muted}"
  button-disabled-edge:
    backgroundColor: "{colors.disabled-edge}"
    height: 4px
---

## Overview

Lookup borrows Duolingo's friendly learning language: leaf-lime actions, chunky raised controls, rounded outlined cards, and confident rounded type. This is an independent app, not a Duolingo replica. Book and check icons are original SVG drawings. No owl, logo, proprietary font files, or copied brand assets ship.

The interface shows one vocabulary card at a time. Front and revealed cards are alternate states, never two cards stacked together. Playfulness comes from tactile controls and truthful saved-review feedback, not invented XP, streaks, hearts, or course progress.

## Colors

White is the page and card foundation. Lime primary actions always use dark forest labels, never white: white on leaf lime fails normal-text contrast. Blue secondary actions use dark navy labels. Text and muted text remain readable on white and soft-gray fields. Light-gray outlines define cards and inputs; focus rings supply a stronger blue boundary for keyboard navigation. Green feedback confirms actual completed work; red feedback identifies actual failures.

All normative color tokens are referenced by a documented component above. Edge and outline components are paint-only regions with no text. Do not invent text/background pairs on those regions.

## Typography

Use locally installed rounded system fonts with a system sans-serif fallback. No font is downloaded or redistributed. Bold headings and expression text establish a friendly voice. Body text stays at 16px, labels at 15px, and compact metadata at 12–14px. Scale expression text from 28px on narrow phones to its 40px token. Use sentence case and preserve Vietnamese diacritics.

## Layout

Keep four top navigation tabs: Review, Library, Add a card, Settings. Follow them with a compact single-row review summary. The summary reports due cards, remaining **new slots** in the daily allowance, and actual reviews today. New slots are not a claim about available cards.

Center content in a 760px maximum-width column. Use 16px phone gutters and 32px desktop gutters. Support 320px, 390px and desktop layouts without horizontal scrolling. Forms and settings remain in normal document flow; refresh does not erase intake text. Use the spacing scale for tight control groups and generous section separation.

## Elevation & Depth

Primary buttons have a solid 4px lower edge in primary-edge; blue buttons use secondary-edge. Pressing translates the button down 3px and reduces the edge to 1px. This tactile hard edge is intentional for this educational design language. Cards use a 2px light-gray outline and a shallow 3px lower ledge, not decorative glow. Disabled controls retain readable labels and lose interactive movement. No hover-only information.

## Shapes

Cards use the 24px radius; controls use 16px; compact badges use 12px. Use soft, original book and check SVGs with consistent rounded strokes. Keep icons decorative when adjacent labels already explain their meaning. Inputs have visible labels and rounded 2px outlines. Do not use emoji as icons.

## Components

- **Review:** one card, English first, Vietnamese only after Reveal meaning. Forgot is blue; Remembered and Reveal meaning are lime. Scheduler intervals are actual values.
- **Empty and graded:** original book artwork invites intake; an original check celebrates the actual up-to-date state. No false achievement metrics.
- **Library:** outlined entries, readable translations, Suspend and Remove from deck controls. Removal remains soft deletion; retain the privacy explanation.
- **Forms and settings:** outlined inputs, raised actions, existing pairing scope and backup warnings. Never expose tokens in screenshots.
- **Feedback:** live status region for successful work and alert region for errors. Loading has visible text and disabled actions. Focus rings are 3px and offset 3px. Respect reduced motion by disabling animation and transitions.

`npm run design:tokens` exports colors, radii and spacing through Google's official native CSS exporter. It adds typography variables from the official parsed typography model, because the 0.4 native exporter omits typography. The generated `public/tokens.css` supplies the actual variables consumed by `public/style.css`. `npm run design:check` checks generated-file parity. `npm run design:lint` runs the official linter without suppressions. Build regenerates tokens.

## Do's and Don'ts

- Do use dark labels on lime and blue, one card at a time, real counters, visible focus, and readable disabled states.
- Do preserve auth, API, idempotency, scheduling, pairing and backup behavior during visual changes.
- Do test empty, front, revealed, graded, library, intake, settings, loading and error states at phone and desktop widths.
- Don't add a speaker button, pronunciation feature, mascot, copied logo, fake rewards, or third-party font assets.
- Don't use the reference image's white-on-lime labels or show its alternate card states simultaneously.
