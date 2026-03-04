import React, { useEffect, useCallback, useRef, useState } from "react";

/** Close a popover/dropdown when clicking outside the ref element. */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active = true,
): void {
  const cbRef = useRef(onClose);
  cbRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cbRef.current();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, active]);
}

/** Generic drag hook. All options read from a ref so onMouseDown is always stable. */
export function useDrag(opts: {
  initial: number;
  min: number;
  max: number;
  /** Extract the raw value from a mouse event (e.g. clientX, or a ratio). */
  getPosition: (e: MouseEvent) => number;
  cursor?: string;
}): { value: number; onMouseDown: (e: React.MouseEvent) => void } {
  const [value, setValue] = useState(opts.initial);
  const dragging = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const { cursor = "col-resize" } = optsRef.current;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const { min, max, getPosition } = optsRef.current;
      setValue(Math.max(min, Math.min(max, getPosition(ev))));
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return { value, onMouseDown };
}
