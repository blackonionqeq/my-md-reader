export function formatRelativeTime(input?: string): string {
  if (!input) {
    return 'Never opened';
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) {
    return 'Just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export function articleStatusLabel(status: string): string {
  switch (status) {
    case 'downloaded':
      return 'Ready';
    case 'failed':
      return 'Failed';
    case 'downloading':
      return 'Downloading';
    default:
      return 'Online only';
  }
}
