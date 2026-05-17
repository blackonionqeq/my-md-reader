export interface DropImportCallbacks {
  onDrop: (files: File[]) => void;
  onDragChange: (active: boolean) => void;
}

function isDesktop(): boolean {
  return window.matchMedia('(pointer: fine)').matches;
}

function filterMarkdownFiles(transfer: DataTransfer | null): File[] {
  return Array.from(transfer?.files ?? []).filter(
    (file) => file.name.toLowerCase().endsWith('.md') || file.type === 'text/markdown'
  );
}

export function dropImport(
  node: HTMLElement,
  callbacks: DropImportCallbacks
): { update: (cb: DropImportCallbacks) => void; destroy: () => void } | undefined {
  if (!isDesktop()) {
    return undefined;
  }

  let cb = callbacks;
  let counter = 0;

  function onDragEnter(event: DragEvent): void {
    event.preventDefault();
    counter++;
    if (event.dataTransfer?.types.includes('Files')) {
      cb.onDragChange(true);
    }
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function onDragLeave(event: DragEvent): void {
    event.preventDefault();
    counter--;
    if (counter <= 0) {
      counter = 0;
      cb.onDragChange(false);
    }
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    counter = 0;
    cb.onDragChange(false);
    const files = filterMarkdownFiles(event.dataTransfer);
    cb.onDrop(files);
  }

  node.addEventListener('dragenter', onDragEnter);
  node.addEventListener('dragover', onDragOver);
  node.addEventListener('dragleave', onDragLeave);
  node.addEventListener('drop', onDrop);

  return {
    update(next: DropImportCallbacks) {
      cb = next;
    },
    destroy() {
      node.removeEventListener('dragenter', onDragEnter);
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    }
  };
}
