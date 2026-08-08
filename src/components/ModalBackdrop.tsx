import { forwardRef, useRef, type HTMLAttributes, type ReactNode } from "react";

interface ModalBackdropProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    "children" | "onClick" | "onPointerCancel" | "onPointerDown" | "onPointerUp"
  > {
  children: ReactNode;
  onRequestClose: () => void;
}

export const ModalBackdrop = forwardRef<HTMLDivElement, ModalBackdropProps>(function ModalBackdrop(
  { children, onRequestClose, ...attributes },
  forwardedRef,
) {
  const pressStartedOnBackdropRef = useRef(false);

  return (
    <div
      {...attributes}
      ref={forwardedRef}
      onPointerDown={(event) => {
        pressStartedOnBackdropRef.current =
          event.isPrimary && event.button === 0 && event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        const shouldClose =
          pressStartedOnBackdropRef.current &&
          event.isPrimary &&
          event.button === 0 &&
          event.target === event.currentTarget;
        pressStartedOnBackdropRef.current = false;
        if (shouldClose) {
          onRequestClose();
        }
      }}
      onPointerCancel={() => {
        pressStartedOnBackdropRef.current = false;
      }}
    >
      {children}
    </div>
  );
});
