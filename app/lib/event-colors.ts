import type { CSSProperties } from "react";
import type { CalendarEventColor } from "@/db/schema";

export const paletteColors = {
  violet: "#8c6cff",
  blue: "#5aace0",
  coral: "#e98175",
  green: "#54ae8c",
  amber: "#dfa93a"
} as const;

export function eventColorHex(color: CalendarEventColor): `#${string}` {
  return color.startsWith("#")
    ? (color as `#${string}`)
    : paletteColors[color as keyof typeof paletteColors];
}

export function eventColorStyle(color: CalendarEventColor): CSSProperties {
  const hex = eventColorHex(color);
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const mix = (target: number, amount: number) =>
    `rgb(${channels.map((channel) => Math.round(channel * (1 - amount) + target * amount)).join(", ")})`;
  return {
    color: mix(0, 0.6),
    borderColor: mix(255, 0.55),
    background: `linear-gradient(145deg, ${mix(255, 0.88)}, ${mix(255, 0.8)})`
  };
}
