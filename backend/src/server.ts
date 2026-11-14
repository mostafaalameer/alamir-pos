import app from './app';
import { env } from './config/env';
import { ensureSupabaseRlsEnabled } from './config/rls';
import { SyncService } from './services/sync.service';

app.listen(env.PORT, () => {
  console.log(`Alamir Market POS Backend running on port ${env.PORT} (${env.CURRENCY})`);

  // Ensure Supabase Row-Level Security (RLS) is enabled on all public tables
  ensureSupabaseRlsEnabled()
    .then(({ securedTables }) => {
      if (securedTables.length > 0) {
        console.log(`Supabase RLS verified on ${securedTables.length} public tables.`);
      }
    })
    .catch(() => {
      // Non-blocking if DB is temporarily unreachable at boot
    });

  // Schedule automated daily database backup snapshot (every 24 hours)
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    void SyncService.generateCloudBackupSnapshot(true).catch(() => {});
  }, TWENTY_FOUR_HOURS_MS).unref();
});

