import { supabase } from '@/integrations/supabase/client';

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditLogEntry {
  action: AuditAction;
  tableName: string;
  recordId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  description?: string;
}

/**
 * Erstellt einen unveränderlichen Audit-Log-Eintrag.
 * Diese Funktion sollte bei jeder CRUD-Operation aufgerufen werden.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.warn('Audit log skipped: No authenticated user');
      return;
    }

    const { error } = await supabase.from('audit_logs').insert({
      user_id: user.id,
      user_email: user.email,
      action: entry.action,
      table_name: entry.tableName,
      record_id: entry.recordId,
      old_values: entry.oldValues || null,
      new_values: entry.newValues || null,
      description: entry.description || null,
    });

    if (error) {
      console.error('Failed to create audit log:', error);
    }
  } catch (error) {
    console.error('Error in logAudit:', error);
  }
}

/**
 * Hilfsfunktion zum Formatieren von Werten für das Audit-Log
 */
export function formatAuditValues(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
