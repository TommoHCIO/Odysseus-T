/**
 * Schema Audit Table — per-field merge strategy
 * Council consensus: CRDT auto-merge for structured fields,
 * LWW+audit for free-text requiring human judgment.
 */

export type MergeStrategy = 'crdt-auto' | 'lww-audit';

export interface FieldDefinition {
  path: string;
  strategy: MergeStrategy;
  operator?: '$set' | '$push' | '$max' | '$unset';
  rationale: string;
}

export const ICS209_FIELDS: FieldDefinition[] = [
  { path: 'incidentName', strategy: 'lww-audit', rationale: 'Free-text; unique per incident' },
  { path: 'incidentNumber', strategy: 'crdt-auto', operator: '$set', rationale: 'Unique key; single author' },
  { path: 'incidentType', strategy: 'crdt-auto', operator: '$set', rationale: 'Enum; no merge ambiguity' },
  { path: 'operationalPeriodStart', strategy: 'crdt-auto', operator: '$set', rationale: 'Single authoritative time' },
  { path: 'operationalPeriodEnd', strategy: 'crdt-auto', operator: '$set', rationale: 'Single authoritative time' },
  { path: 'sizeAcres', strategy: 'crdt-auto', operator: '$max', rationale: 'Conservative: highest size' },
  { path: 'percentContained', strategy: 'crdt-auto', operator: '$max', rationale: 'Conservative: highest containment' },
  { path: 'personnel.*', strategy: 'crdt-auto', operator: '$set', rationale: 'Map of role→count; independent edits' },
  { path: 'equipment.*', strategy: 'crdt-auto', operator: '$set', rationale: 'Map of type→count; independent edits' },
  { path: 'fuelType', strategy: 'crdt-auto', operator: '$set', rationale: 'Single enum value' },
  { path: 'hazards', strategy: 'lww-audit', rationale: 'Free-text; human judgment required' },
  { path: 'situationSummary', strategy: 'lww-audit', rationale: 'Free-text narrative; human judgment required' },
  { path: 'remarks', strategy: 'lww-audit', rationale: 'Free-text; human judgment required' },
  { path: 'changeHistory', strategy: 'crdt-auto', operator: '$push', rationale: 'Append-only log' },
];

export const ICS214_FIELDS: FieldDefinition[] = [
  { path: 'logEntryId', strategy: 'crdt-auto', operator: '$set', rationale: 'UUID; no conflict' },
  { path: 'operatorName', strategy: 'lww-audit', rationale: 'Free-text; could be wrong' },
  { path: 'activityDescription', strategy: 'lww-audit', rationale: 'Free-text narrative; human judgment required' },
  { path: 'operationalPeriod', strategy: 'crdt-auto', operator: '$set', rationale: 'Enum; single selection' },
  { path: 'timestamp', strategy: 'crdt-auto', operator: '$set', rationale: 'Authoritative time' },
  { path: 'handoffNotes', strategy: 'lww-audit', rationale: 'Free-text; human judgment required' },
  { path: 'resourceAssignments', strategy: 'crdt-auto', operator: '$push', rationale: 'Append-only; new entries merge' },
];

export function getMergeStrategy(collection: string, fieldPath: string): MergeStrategy {
  const table = collection === 'incidents' ? ICS209_FIELDS : ICS214_FIELDS;
  const match = table.find(f => {
    if (f.path.includes('*')) {
      const prefix = f.path.replace('.*', '.');
      return fieldPath.startsWith(prefix);
    }
    return f.path === fieldPath;
  });
  return match?.strategy ?? 'lww-audit'; // safe default: human review
}

export function getOperator(collection: string, fieldPath: string): string | undefined {
  const table = collection === 'incidents' ? ICS209_FIELDS : ICS214_FIELDS;
  const match = table.find(f => {
    if (f.path.includes('*')) {
      const prefix = f.path.replace('.*', '.');
      return fieldPath.startsWith(prefix);
    }
    return f.path === fieldPath;
  });
  return match?.operator;
}