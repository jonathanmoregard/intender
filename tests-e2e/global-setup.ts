import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

export default async function globalSetup() {
  // Use run dir computed in playwright.config.ts; fallback only if absent
  const envRunDir = process.env.INTENDER_TEST_RUN_DIR;
  const runDir = envRunDir || join(process.cwd(), '.test-results');

  // Ensure run dir exists and create logs subdirectory
  await mkdir(join(runDir, 'logs'), { recursive: true });

  // Write run metadata (best-effort)
  try {
    const runMetadata = {
      startTime: new Date().toISOString(),
      runDir,
      throttled: !!process.env.INTENDER_THROTTLE,
    } as const;
    await writeFile(
      join(runDir, 'run.json'),
      JSON.stringify(runMetadata, null, 2)
    );
  } catch {}

  console.log(`📁 Test run directory: ${runDir}`);
}
