const globals = globalThis as typeof globalThis & { wakeAchievements?: () => void };

export function registerAchievementWake(wake: () => void) {
  globals.wakeAchievements = wake;
}

export function wakeAchievements() {
  globals.wakeAchievements?.();
}
