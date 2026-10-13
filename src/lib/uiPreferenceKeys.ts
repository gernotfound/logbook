/** UI preferences are device-local but must not be shared across authenticated owners. */
export const ownerUiPreferenceKey = (owner: string, preference: string): string =>
  `logbook:v2:${owner}:ui:${preference}`;
