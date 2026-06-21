import { writable, get } from "svelte/store";
import type { SessionState } from "$lib/types";

const LS_KEY = "agentry.sessionOrder";

type OrderMap = Record<string, string[]>;

function load(): OrderMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as OrderMap) : {};
  } catch {
    return {};
  }
}

function persist(map: OrderMap) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** Per-project explicit session ordering. Keyed by projectId → ordered ids. */
export const sessionOrder = writable<OrderMap>(load());

sessionOrder.subscribe(persist);

/**
 * Return `items` sorted by the user's saved order for `projectId`.
 * Sessions without a saved position keep their incoming (insertion) order
 * and are appended after the known ones.
 */
export function applyOrder<T extends SessionState>(
  projectId: string,
  items: T[],
): T[] {
  const order = get(sessionOrder)[projectId];
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const fallback = order.length;
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id) ?? fallback;
    const rb = rank.get(b.id) ?? fallback;
    return ra - rb;
  });
}

/**
 * Reorder so that `draggedId` is inserted relative to `targetId`, given the
 * full visible ordering of session ids for the project. When `before` is true
 * the dragged id lands just above the target, otherwise just below it.
 */
export function moveSession(
  projectId: string,
  visibleIds: string[],
  draggedId: string,
  targetId: string,
  before = true,
) {
  if (draggedId === targetId) return;
  const ids = visibleIds.filter((id) => id !== draggedId);
  const targetIdx = ids.indexOf(targetId);
  if (targetIdx === -1) return;
  ids.splice(before ? targetIdx : targetIdx + 1, 0, draggedId);
  sessionOrder.update((m) => ({ ...m, [projectId]: ids }));
}
