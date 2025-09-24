# Intender Style Guide

## Design Philosophy

Intender embraces a **mindful, non-coercive approach** to digital wellness. Rather than blocking or punishing users, it creates gentle moments of reflection and intentionality.

### Core Principles

- **Minimalist aesthetic** with clean typography and subtle shadows
- **Warm, earthy color palette** featuring muted golds and soft grays
- **Encouraging, not demanding** - Frames reflection as an opportunity rather than a requirement
- **Mindfulness-focused** - Emphasizes intention-setting and conscious browsing
- **Non-judgmental** - Avoids shaming or punitive language around web usage

## Color Palette

### Primary Colors

- Centralized in `public/styles/theme.css` via CSS variables. Use variables instead of hardcoded hex.
- Primary variables:
  - `--color-accent` (`--color-accent-rgb`) – error/accent
  - `--color-primary` (`--color-primary-rgb`) – success/brand gold
  - `--color-bg` – default background
  - `--color-text` – primary text
  - `--color-white` (`--color-white-rgb`)
  - `--color-muted-rgb` – for text alpha variants
  - `--shadow-weak-rgb` – for shadow alphas
  - `--color-warm1-rgb`, `--color-warm2-rgb` – warm overlays

### Text Colors

- Use `var(--text-primary)` for primary text.
- For alpha variants use ontology tokens: `var(--text-secondary)`, `var(--text-tertiary)`, etc.
- White text on color: `var(--text-white)`.
- Error text: `var(--text-error)`; Success text: `var(--text-success)`.

### Background Colors

- Error bg: `var(--bg-error)`
- Success bg: `var(--bg-success)`
- Error label bg: keep as-is or align with token if added later

## Typography

- **Primary**: `'Inter', sans-serif` - Interface elements
- **Secondary (for intention text)**: `'Merriweather', serif` (italic) - Intention text

## Buttons

### Primary Action Buttons

- **Background**: Linear gradient from `rgba(X,X,X, 0.8) to `rgba(X,X,X, 0.6)`
- **Text**: Pure white at 90% opacity (`rgba(255, 255, 255, 0.9)`)
- **Border**: 1px solid `rgba(X,X,X, 0.4)`
- **Border radius**: 12px
- **Typography**: Inter, 500 weight, 0.5px letter spacing
- **Shadow**: 2px y-offset, 6px blur, 30% black (`0 2px 6px rgba(0, 0, 0, 0.3)`)
- **Hover state**: Brighten gradient by ~5%, scale to 102%, shadow becomes `0 4px 12px rgba(0, 0, 0, 0.4)`
- **Transition**: 150ms ease for hover interactions

### Round Symbol Buttons

- **Background**: Theme-appropriate color (red for delete, green for add, etc.)
- **Text**: Pure white
- **Border**: None
- **Border radius**: 50% (circular)
- **Typography**: Inter, 1.2rem font size, line-height: 1
- **Shadow**: 2px y-offset, 6px blur, 30% opacity of button color (`0 2px 6px rgba(button-color, 0.3)`)
- **Hover state**: Darker version of button color, scale to 110%, enhanced shadow (`0 4px 12px rgba(button-color, 0.4)`)
- **Shift-held state**: Brighter version of button color, larger size (36px), enhanced shadow (`0 4px 12px rgba(brighter-color, 0.5)`)
- **Transition**: 150ms ease for all interactions

### Disabled Buttons

#### Primary Action Buttons (Disabled)

- **Background**: Linear gradient from `rgba(128, 128, 128, 0.6)` to `rgba(128, 128, 128, 0.4)`
- **Text**: `rgba(255, 255, 255, 0.9)` (white text)
- **Border**: 1px solid `rgba(128, 128, 128, 0.4)`
- **Cursor**: `not-allowed`
- **Shadow**: Reduced shadow (`0 2px 8px rgba(0, 0, 0, 0.05)`)
- **Opacity**: No additional opacity changes (maintains visual presence)

#### Round Symbol Buttons (Disabled)

- **Background**: `rgba(128, 128, 128, 0.6)` (grey)
- **Text**: Pure white
- **Border**: None
- **Cursor**: `not-allowed`
- **Shadow**: Reduced shadow (`0 2px 6px rgba(128, 128, 128, 0.2)`)
- **Hover state**: No hover effects (disabled)

## Related Documentation

For contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).
