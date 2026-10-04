/**
 * The performance overlay (product v7 contract section 9, stream G, step G1): on a VITE_E2E=1 build,
 * /?perf=1 shows the section 9 measures over whatever page the URL opens (the focus check, a coached
 * session), for the runs on the reference phones.
 *
 * Placeholder of step A6 (contract 1.3), replaced by G1: it renders nothing. src/app/App.tsx mounts it
 * over every page in a VITE_E2E=1 build only, so a default build has no chunk for it.
 */
export default function PerfOverlay(): null {
  return null;
}
