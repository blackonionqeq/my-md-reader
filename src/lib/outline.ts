import type { OutlineHeading } from './types';

export function collectHeadings(container: HTMLElement, idPrefix?: string): OutlineHeading[] {
  const normalizedPrefix = idPrefix?.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

  return Array.from(container.querySelectorAll('h1, h2, h3')).map((node, index) => {
    const element = node as HTMLHeadingElement;
    if (!element.id) {
      element.id = normalizedPrefix ? `${normalizedPrefix}-heading-${index}` : `heading-${index}`;
    }

    return {
      id: element.id,
      level: Number(element.tagName.slice(1)),
      text: element.textContent?.trim() ?? 'Untitled'
    };
  });
}
