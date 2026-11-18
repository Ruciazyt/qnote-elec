export type DragReorderMode = "row" | "list" | "grid";

export interface DragRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DragSlot extends DragRect {
  id: string;
}

export interface DragGap {
  index: number;
  orientation: "vertical" | "horizontal";
  x: number;
  y: number;
  length: number;
}

export interface DragRipple {
  dx: number;
  dy: number;
  delay: number;
}

export interface DragRow {
  top: number;
  bottom: number;
  left: number;
  right: number;
  slots: DragSlot[];
  start: number;
}

export const RIPPLE_DECAY = 0.7;
export const RIPPLE_STAGGER_MS = 24;
export const ROW_TOLERANCE = 2;
export const EDGE_INSET = 6;

export function rippleAmplitude(base: number, distance: number): number {
  let value = base;
  for (let i = 0; i < distance; i += 1) value *= RIPPLE_DECAY;
  return value;
}

export function groupRows(slots: DragSlot[]): DragRow[] {
  const rows: DragRow[] = [];

  for (const slot of slots) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.top - slot.y) <= ROW_TOLERANCE) {
      row.slots.push(slot);
      row.bottom = Math.max(row.bottom, slot.y + slot.h);
      row.left = Math.min(row.left, slot.x);
      row.right = Math.max(row.right, slot.x + slot.w);
      continue;
    }
    rows.push({
      top: slot.y,
      bottom: slot.y + slot.h,
      left: slot.x,
      right: slot.x + slot.w,
      slots: [slot],
      start: 0,
    });
  }

  let cursor = 0;
  for (const row of rows) {
    row.start = cursor;
    cursor += row.slots.length;
  }
  return rows;
}

function rowIndexFor(rows: DragRow[], gapIndex: number): number {
  const found = rows.findIndex((row) => gapIndex < row.start + row.slots.length);
  return found === -1 ? rows.length - 1 : found;
}

function gapAxis(
  slots: DragSlot[],
  gapIndex: number,
  axis: "x" | "y"
): number {
  if (gapIndex <= 0) return slots[0][axis] - EDGE_INSET;
  if (gapIndex >= slots.length) {
    const last = slots[slots.length - 1];
    return axis === "x" ? last.x + last.w + EDGE_INSET : last.y + last.h + EDGE_INSET;
  }
  const before = slots[gapIndex - 1];
  const after = slots[gapIndex];
  if (axis === "x") return (before.x + before.w + after.x) / 2;
  return (before.y + before.h + after.y) / 2;
}

export function computeGap(
  slots: DragSlot[],
  mode: DragReorderMode,
  gapIndex: number
): DragGap | null {
  if (slots.length === 0) return null;

  if (mode === "row") {
    let top = slots[0].y;
    let bottom = slots[0].y + slots[0].h;
    for (const slot of slots) {
      top = Math.min(top, slot.y);
      bottom = Math.max(bottom, slot.y + slot.h);
    }
    return {
      index: gapIndex,
      orientation: "vertical",
      x: gapAxis(slots, gapIndex, "x"),
      y: top,
      length: bottom - top,
    };
  }

  if (mode === "list") {
    let left = slots[0].x;
    let right = slots[0].x + slots[0].w;
    for (const slot of slots) {
      left = Math.min(left, slot.x);
      right = Math.max(right, slot.x + slot.w);
    }
    return {
      index: gapIndex,
      orientation: "horizontal",
      x: left,
      y: gapAxis(slots, gapIndex, "y"),
      length: right - left,
    };
  }

  const rows = groupRows(slots);
  const rowIndex = rowIndexFor(rows, gapIndex);
  const row = rows[rowIndex];
  const column = gapIndex - row.start;

  if (column === 0 && rowIndex > 0) {
    const previous = rows[rowIndex - 1];
    let left = rows[0].left;
    let right = rows[0].right;
    for (const candidate of rows) {
      left = Math.min(left, candidate.left);
      right = Math.max(right, candidate.right);
    }
    return {
      index: gapIndex,
      orientation: "horizontal",
      x: left,
      y: (previous.bottom + row.top) / 2,
      length: right - left,
    };
  }

  return {
    index: gapIndex,
    orientation: "vertical",
    x: gapAxis(row.slots, column, "x"),
    y: row.top,
    length: row.bottom - row.top,
  };
}

export function computeRipples(
  slots: DragSlot[],
  mode: DragReorderMode,
  gapIndex: number,
  amplitude: number
): Map<string, DragRipple> {
  const result = new Map<string, DragRipple>();
  if (slots.length === 0) return result;

  if (mode === "row" || mode === "list") {
    const horizontal = mode === "row";
    slots.forEach((slot, index) => {
      const before = index < gapIndex;
      const distance = before ? gapIndex - 1 - index : index - gapIndex;
      const offset = rippleAmplitude(amplitude, distance);
      const ripple: DragRipple = {
        dx: horizontal ? (before ? -offset : offset) : 0,
        dy: horizontal ? 0 : before ? -offset : offset,
        delay: distance * RIPPLE_STAGGER_MS,
      };
      result.set(slot.id, ripple);
    });
    return result;
  }

  const gap = computeGap(slots, mode, gapIndex);
  if (!gap) return result;

  const rows = groupRows(slots);
  const rowIndex = rowIndexFor(rows, gapIndex);
  const row = rows[rowIndex];

  if (gap.orientation === "horizontal") {
    rows.forEach((candidate, index) => {
      const before = index < rowIndex;
      const distance = before ? rowIndex - 1 - index : index - rowIndex;
      const offset = rippleAmplitude(amplitude, distance);
      for (const slot of candidate.slots) {
        result.set(slot.id, {
          dx: 0,
          dy: before ? -offset : offset,
          delay: distance * RIPPLE_STAGGER_MS,
        });
      }
    });
    return result;
  }

  const column = gapIndex - row.start;
  row.slots.forEach((slot, index) => {
    const before = index < column;
    const distance = before ? column - 1 - index : index - column;
    const offset = rippleAmplitude(amplitude, distance);
    result.set(slot.id, {
      dx: before ? -offset : offset,
      dy: 0,
      delay: distance * RIPPLE_STAGGER_MS,
    });
  });
  return result;
}

export function findGapIndex(
  slots: DragSlot[],
  mode: DragReorderMode,
  pointerX: number,
  pointerY: number
): number {
  if (slots.length === 0) return 0;

  if (mode === "row") {
    for (let index = 0; index < slots.length; index += 1) {
      if (pointerX < slots[index].x + slots[index].w / 2) return index;
    }
    return slots.length;
  }

  if (mode === "list") {
    for (let index = 0; index < slots.length; index += 1) {
      if (pointerY < slots[index].y + slots[index].h / 2) return index;
    }
    return slots.length;
  }

  const rows = groupRows(slots);
  let rowIndex = rows.findIndex((row) => pointerY < row.bottom);
  if (rowIndex === -1) rowIndex = rows.length - 1;
  const row = rows[rowIndex];
  for (let index = 0; index < row.slots.length; index += 1) {
    if (pointerX < row.slots[index].x + row.slots[index].w / 2) return row.start + index;
  }
  return row.start + row.slots.length;
}

export function insertAt(order: string[], id: string, index: number): string[] {
  const next = order.filter((item) => item !== id);
  const target = Math.max(0, Math.min(next.length, index));
  next.splice(target, 0, id);
  return next;
}
