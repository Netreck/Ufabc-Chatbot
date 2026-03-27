import { useCallback, useRef } from "react";

export function useResize(
  getTarget: () => HTMLElement | null,
  setSize: (px: number) => void,
  min: number,
  max: number,
  direction: 1 | -1 = 1
) {
  const handleRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const target = getTarget();
      if (!target) return;
      const startX = e.clientX;
      const startSize = target.getBoundingClientRect().width;
      const handle = handleRef.current;
      handle?.classList.add("dragging");

      const onMouseMove = (ev: MouseEvent) => {
        const delta = (ev.clientX - startX) * direction;
        const newSize = Math.min(max, Math.max(min, startSize + delta));
        setSize(newSize);
      };

      const onMouseUp = () => {
        handle?.classList.remove("dragging");
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [getTarget, setSize, min, max, direction]
  );

  return { handleRef, onMouseDown };
}
