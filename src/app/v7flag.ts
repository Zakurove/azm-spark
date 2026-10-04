/**
 * The v7 build flag (product v7 contract C-9, 1.2): VITE_V7=1 builds the v7 screens (staging and
 * dev), unset in production until the release decision. A build constant, so a default build drops
 * every `V7_UI ? lazy(...) : null` chunk (8.8). The only v7 module the landing may import.
 */
export const V7_UI = import.meta.env.VITE_V7 === "1";
