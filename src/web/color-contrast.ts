export interface OpaqueRgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const OPAQUE_HEX_COLOR = /^#(?<red>[\da-f]{2})(?<green>[\da-f]{2})(?<blue>[\da-f]{2})$/i;

/** Parses only fully opaque six-digit CSS hex colors; alpha notation is intentionally rejected. */
export function parseOpaqueHexColor(value: string): OpaqueRgbColor {
  const match = OPAQUE_HEX_COLOR.exec(value);
  if (match?.groups === undefined) {
    throw new TypeError(`Expected an opaque #RRGGBB color, received ${JSON.stringify(value)}.`);
  }

  return {
    red: Number.parseInt(match.groups.red, 16),
    green: Number.parseInt(match.groups.green, 16),
    blue: Number.parseInt(match.groups.blue, 16),
  };
}

/** Returns WCAG relative luminance using the sRGB transfer function. */
export function relativeLuminance(color: OpaqueRgbColor): number {
  return 0.2126 * linearSrgb(color.red) + 0.7152 * linearSrgb(color.green) + 0.0722 * linearSrgb(color.blue);
}

/** Returns the WCAG contrast ratio for two opaque colors, from 1 through 21. */
export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseOpaqueHexColor(foreground));
  const backgroundLuminance = relativeLuminance(parseOpaqueHexColor(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function linearSrgb(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}
