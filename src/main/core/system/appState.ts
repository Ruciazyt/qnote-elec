
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}

export function shouldHideToTray(): boolean {
  return !quitting;
}
