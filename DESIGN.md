---
name: Vesprism Design System
colors:
  surface: '#fbf9f6'
  surface-dim: '#dbdad7'
  surface-bright: '#fbf9f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f0'
  surface-container: '#efeeeb'
  surface-container-high: '#eae8e5'
  surface-container-highest: '#e4e2df'
  on-surface: '#1b1c1a'
  on-surface-variant: '#444748'
  inverse-surface: '#30312f'
  inverse-on-surface: '#f2f0ed'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#181919'
  on-primary: '#ffffff'
  primary-container: '#2d2d2d'
  on-primary-container: '#959494'
  inverse-primary: '#c8c6c6'
  secondary: '#4e616a'
  on-secondary: '#ffffff'
  secondary-container: '#cee3ee'
  on-secondary-container: '#52656f'
  tertiary: '#3b0100'
  on-tertiary: '#ffffff'
  tertiary-container: '#5c0f07'
  on-tertiary-container: '#e37463'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e4e2e1'
  primary-fixed-dim: '#c8c6c6'
  on-primary-fixed: '#1b1c1c'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#d1e6f0'
  secondary-fixed-dim: '#b5cad4'
  on-secondary-fixed: '#0a1e26'
  on-secondary-fixed-variant: '#374952'
  tertiary-fixed: '#ffdad4'
  tertiary-fixed-dim: '#ffb4a7'
  on-tertiary-fixed: '#410100'
  on-tertiary-fixed-variant: '#80291d'
  background: '#fbf9f6'
  on-background: '#1b1c1a'
  surface-variant: '#e4e2df'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.2'
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  margin: 32px
  sidebar_width: 260px
---

## Brand & Style

The design system is a "Digital Artisan" aesthetic—a curated intersection of retro pixel-level precision and the organic, flowing lines of hand-inked sketches. It targets independent developers and creative professionals who value the "indie-dev" spirit: highly functional, yet rich with personality and human touch.

The visual style is **Minimalist-Brutalist with Tactile infusions**. It uses the rigid structural constraints of a pixel-grid to define layouts, but softens the edges with hand-drawn, illustrative strokes. This duality evokes a sense of sophisticated craftsmanship, bridging the gap between cold digital execution and warm human intent.

## Colors

The palette is grounded in a "Paper and Ink" foundation. The background utilizes a warm off-white, suggesting the texture of heavy-stock paper. 

- **Primary (Deep Charcoal):** Used for typography and structural borders. It represents the "ink."
- **Secondary (Muted Slate):** Used for secondary UI elements, such as sidebar backgrounds and inactive states.
- **Functional Accents:** Inspired by the pixel-art reference, **Terracotta (#D96C5B)** signifies errors or critical actions; **Mustard (#E6B34D)** is used for warnings or highlights; and **Teal (#4DA699)** marks successes and active progress.
- **Base Surfaces:** All surfaces should maintain high legibility against the charcoal ink, utilizing subtle grey-wash tints for nested containers.

## Typography

This design system utilizes a high-contrast typographic pairing to reinforce the "Prism" narrative.

**Headlines (Space Grotesk):** A geometric sans-serif that feels engineered and futuristic. Its deep ink-traps and sharp terminals mimic the precision of a prism. Use this for all structural headings and large display text.

**Body & Interface (JetBrains Mono):** A monospaced font that bridges the gap between technical code and clean documentation. It provides the "indie-dev" aesthetic while remaining highly legible for long-form content.

**Stylistic Note:** Labels should often be set in uppercase with increased letter spacing to act as "metadata" markers within the interface.

## Layout & Spacing

The layout is governed by a **fixed-column grid system** on desktop to ensure "pixel-perfect" alignment, transitioning to a fluid model for smaller viewports.

- **Grid Model:** 12-column grid with a fixed maximum width of 1440px for content.
- **Rhythm:** An 8px linear scale is used for all spatial relationships.
- **Safe Margins:** Use a generous 32px external margin to allow the UI to "breathe" against the paper-textured background.
- **Sidebar:** A persistent left-hand sidebar (260px) provides the "prism" structure, acting as the primary anchor for navigation.
- **Reflow:** On mobile, the 12-column grid collapses to a 4-column layout with the sidebar transforming into a bottom-sheet or full-screen overlay.

## Elevation & Depth

In keeping with the "Digital Artisan" style, this design system rejects realistic shadows in favor of **Tonal Layering and Direct Outlines**.

- **Elevation 0 (Base):** Off-white background with a subtle "paper" noise texture.
- **Elevation 1 (Containers):** White surfaces with a 1px Charcoal (#2D2D2D) border. No shadow.
- **Elevation 2 (Interactive/Floating):** Use a "Hard Shadow" technique—a solid 2px offset of the Primary Charcoal color to create a "sticker" or "pixel-art" depth effect.
- **Organic Depth:** Use hand-drawn, slightly irregular "sketch" strokes for decorative dividers or as a secondary border style for cards to contrast with the rigid pixel-grid.

## Shapes

The primary shape language is **Sharp (0px)**. This reinforces the pixel-art precision and the "prism" geometry.

- **Base Components:** Buttons, inputs, and cards must have strictly square corners.
- **The "Organic" Exception:** While the containers are sharp, the *interior icons* or *illustrative elements* should utilize the soft, hand-drawn strokes found in the mountain/ink-wash logo.
- **Interactive States:** When a component is active, use a 2px interior border offset to create a "pressed" effect without rounding the corners.

## Components

### Buttons
- **Primary:** Solid Deep Charcoal background with White JetBrains Mono text. No rounded corners. 
- **Secondary:** Transparent background with a 1px Deep Charcoal border.
- **Style Detail:** Use a 2px "Pixel Offset" shadow (solid color, no blur) on hover.

### Cards
- **Structure:** 1px Deep Charcoal border, 24px padding. 
- **Header:** Separate the header with a horizontal line that looks like a hand-drawn ink stroke (variable weight, slightly tapered).

### Input Fields
- **Default:** 1px Deep Charcoal border, JetBrains Mono body text.
- **Focus:** Border weight increases to 2px; use the Accent Teal for the cursor and a subtle Mustard underline.

### Navigation
- **Sidebar:** Muted Slate (#4A5D66) background. Links are white with a Teal "pixel-block" indicator to the left of the active item.

### Chips/Tags
- **Appearance:** Small, sharp-cornered rectangles. Use the accent palette (Terracotta, Mustard, Teal) at 10% opacity for the background and 100% opacity for the label text.

### Dividers
- Use "Prism Lines"—ultra-thin (0.5px) lines that occasionally break into a hand-drawn squiggle to maintain the artisan feel.