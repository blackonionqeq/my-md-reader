export interface FocusModeController {
  enter(): void;
  exit(): void;
  toggle(): void;
  destroy(): void;
}

export function createFocusMode(
  onFocusChange: (active: boolean) => void
): FocusModeController {
  function syncState(): void {
    onFocusChange(Boolean(document.fullscreenElement));
  }

  function enter(): void {
    document.documentElement.requestFullscreen?.().catch(() => {
      onFocusChange(true);
    });
  }

  function exit(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {
        onFocusChange(false);
      });
    } else {
      onFocusChange(false);
    }
  }

  function toggle(): void {
    if (document.fullscreenElement) {
      exit();
    } else {
      enter();
    }
  }

  document.addEventListener('fullscreenchange', syncState);

  return {
    enter,
    exit,
    toggle,
    destroy() {
      document.removeEventListener('fullscreenchange', syncState);
    }
  };
}
