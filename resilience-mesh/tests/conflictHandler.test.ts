import { describe, it, expect, beforeEach } from 'vitest';
import { HybridConflictHandler } from '../src/stores/conflictHandler';

describe('HybridConflictHandler', () => {
  let handler: HybridConflictHandler;

  beforeEach(() => {
    handler = new HybridConflictHandler();
  });

  it('auto-merges CRDT-safe numeric fields without creating a conflict', () => {
    const { result, conflictCreated } = handler.handleFieldConflict(
      'incidents', 'INC-001', 'percentContained',
      35, 50, { localAuthor: 'Field Alpha', remoteAuthor: 'Field Bravo' }
    );
    expect(result).toBe(50); // remote wins via CRDT auto-merge
    expect(conflictCreated).toBe(false);
    expect(handler.getUnresolvedConflicts()).toHaveLength(0);
  });

  it('auto-merges CRDT-safe enum fields', () => {
    const { result, conflictCreated } = handler.handleFieldConflict(
      'incidents', 'INC-001', 'incidentType',
      'Wildland Fire', 'Flood', { localAuthor: 'A', remoteAuthor: 'B' }
    );
    expect(result).toBe('Flood');
    expect(conflictCreated).toBe(false);
  });

  it('flags LWW+audit free-text fields as conflicts requiring human review', () => {
    const { result, conflictCreated } = handler.handleFieldConflict(
      'incidents', 'INC-001', 'situationSummary',
      'Fire moving east at moderate rate.', 'Fire moving west toward populated area.',
      { localAuthor: 'Field Alpha', remoteAuthor: 'Field Bravo' }
    );
    expect(conflictCreated).toBe(true);
    expect(handler.getUnresolvedConflicts()).toHaveLength(1);
    expect(result).toBe('Fire moving east at moderate rate.'); // local kept temporarily
  });

  it('flags ICS-214 activity descriptions as conflicts', () => {
    const { conflictCreated } = handler.handleFieldConflict(
      'activityLogs', 'LOG-001', 'activityDescription',
      'Size-up complete.', 'Evacuation underway.',
      { localAuthor: 'S. Chen', remoteAuthor: 'M. Rivera' }
    );
    expect(conflictCreated).toBe(true);
  });

  it('applies chosen version on resolution', () => {
    handler.handleFieldConflict(
      'incidents', 'INC-001', 'remarks',
      'Version A', 'Version B',
      { localAuthor: 'Alpha', remoteAuthor: 'Bravo' }
    );
    const chosen = handler.resolveConflict('conflict-1', 'remote');
    expect(chosen).toBe('Version B');
    expect(handler.getUnresolvedConflicts()).toHaveLength(0);
  });

  it('preserves audit trail after resolution', () => {
    handler.handleFieldConflict(
      'incidents', 'INC-001', 'situationSummary',
      'Old narrative', 'New narrative',
      { localAuthor: 'Field Alpha', remoteAuthor: 'Field Bravo' }
    );
    handler.resolveConflict('conflict-1', 'local');
    const trail = handler.getAuditTrail();
    expect(trail).toHaveLength(1);
    expect(trail[0].resolved).toBe(true);
    expect(trail[0].resolution).toBe('local');
    expect(trail[0].localAuthor).toBe('Field Alpha');
    expect(trail[0].remoteValue).toBe('New narrative');
    expect(trail[0].localValue).toBe('Old narrative');
  });

  it('handles multiple conflicts independently', () => {
    handler.handleFieldConflict('incidents', 'INC-001', 'situationSummary', 'A1', 'B1', { localAuthor: 'A', remoteAuthor: 'B' });
    handler.handleFieldConflict('incidents', 'INC-001', 'remarks', 'A2', 'B2', { localAuthor: 'A', remoteAuthor: 'B' });
    handler.handleFieldConflict('incidents', 'INC-002', 'situationSummary', 'A3', 'B3', { localAuthor: 'C', remoteAuthor: 'D' });

    expect(handler.getUnresolvedConflicts()).toHaveLength(3);

    handler.resolveConflict('conflict-1', 'local');
    handler.resolveConflict('conflict-2', 'remote');
    expect(handler.getUnresolvedConflicts()).toHaveLength(1);
    expect(handler.getAllConflicts()).toHaveLength(3);
  });

  it('returns null for already-resolved or nonexistent conflicts', () => {
    handler.handleFieldConflict('incidents', 'INC-001', 'remarks', 'X', 'Y', { localAuthor: 'A', remoteAuthor: 'B' });
    handler.resolveConflict('conflict-1', 'local');
    const again = handler.resolveConflict('conflict-1', 'remote');
    expect(again).toBeNull();
    const nonexistent = handler.resolveConflict('nope', 'local');
    expect(nonexistent).toBeNull();
  });
});