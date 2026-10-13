// Database identities are versioned; engine identities survive reconstruction.
const PREFIX = "projection::";
export function logicalId(id: string): string {
  if (!id.startsWith(PREFIX)) return id;
  const separator = id.indexOf("::", PREFIX.length);
  return separator < 0 ? id : id.slice(separator + 2);
}
export function projectionRecordId(projectionId: string | undefined | null, id: string): string {
  return projectionId ? `${PREFIX}${projectionId}::${logicalId(id)}` : id;
}
