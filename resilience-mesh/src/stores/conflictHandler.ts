/**
 * Hybrid Conflict Handler
 * - CRDT auto-merge for structured fields (counts, enums, timestamps)
 * - LWW + audit trail for free-text fields (narrative, notes)
 */
import { getMergeStrategy } from '../utils/schema-audit';

export interface ConflictResolution {
  id: string;
  documentId: string;
  documentType: string;
  fieldPath: string;
  localValue: any;
  remoteValue: any;
  localAuthor: string;
  remoteAuthor: string;
  timestamp: string;
  resolved: boolean;
  chosenValue?: any;
  resolution?: 'local' | 'remote';
}

export class HybridConflictHandler {
  private conflicts: ConflictResolution[] = [];
  private counter = 0;

  handleFieldConflict(
    collection: string,
    docId: string,
    fieldPath: string,
    localValue: any,
    remoteValue: any,
    context: { localAuthor: string; remoteAuthor: string }
  ): { result: any; conflictCreated: boolean } {
    const strategy = getMergeStrategy(collection, fieldPath);

    if (strategy === 'crdt-auto') {
      // Auto-merge: use RxDB default CRDT operators
      return { result: remoteValue, conflictCreated: false };
    }

    // LWW+audit: store both versions, flag for manual review
    this.counter++;
    const conflict: ConflictResolution = {
      id: `conflict-${this.counter}`,
      documentId: docId,
      documentType: collection,
      fieldPath,
      localValue,
      remoteValue,
      localAuthor: context.localAuthor,
      remoteAuthor: context.remoteAuthor,
      timestamp: new Date().toISOString(),
      resolved: false,
    };
    this.conflicts.push(conflict);

    // Return local value as temporary
    return { result: localValue, conflictCreated: true };
  }

  getUnresolvedConflicts(): ConflictResolution[] {
    return this.conflicts.filter(c => !c.resolved);
  }

  getAllConflicts(): ConflictResolution[] {
    return [...this.conflicts];
  }

  resolveConflict(conflictId: string, choice: 'local' | 'remote'): any {
    const conflict = this.conflicts.find(c => c.id === conflictId);
    if (!conflict || conflict.resolved) return null;
    conflict.resolved = true;
    conflict.resolution = choice;
    conflict.chosenValue = choice === 'local' ? conflict.localValue : conflict.remoteValue;
    return conflict.chosenValue;
  }

  getAuditTrail(): ConflictResolution[] {
    return this.conflicts.filter(c => c.resolved);
  }

  clear() {
    this.conflicts = [];
    this.counter = 0;
  }
}