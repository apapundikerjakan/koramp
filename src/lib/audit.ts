import { prisma } from './prisma';

/** Shared audit writer — dedup of ~20 copy-pasted prisma.auditLog.create calls. */
export async function audit(opts: {
  action: string;
  entity: string;
  entityId?: string;
  actor: string;
  metadata?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: opts.action,
        entity: opts.entity,
        ...(opts.entityId ? { entityId: opts.entityId } : {}),
        actor: opts.actor,
        ...(opts.metadata !== undefined
          ? { metadata: typeof opts.metadata === 'string' ? opts.metadata : JSON.stringify(opts.metadata) }
          : {}),
      },
    });
  } catch {
    // audit must never break business logic
  }
}
