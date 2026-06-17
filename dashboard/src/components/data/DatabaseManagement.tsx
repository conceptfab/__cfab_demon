import { DatabaseBackupCard } from '@/components/data/DatabaseBackupCard';
import { DatabaseCleanupCard } from '@/components/data/DatabaseCleanupCard';
import { DatabaseHealthCard } from '@/components/data/DatabaseHealthCard';
import { useDatabaseManagementController } from '@/hooks/useDatabaseManagementController';

export function DatabaseManagement() {
  const controller = useDatabaseManagementController();
  const { info, settings } = controller;

  if (!settings || !info) return null;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <DatabaseHealthCard {...controller} />
        <DatabaseBackupCard {...controller} />
      </div>
      <DatabaseCleanupCard {...controller} />
    </div>
  );
}
