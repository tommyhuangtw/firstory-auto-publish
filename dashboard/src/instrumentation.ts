/**
 * Next.js Instrumentation — runs once on server startup.
 * Used to initialize scheduler cron jobs.
 */

export async function register() {
  // Only run on the server (not during build or in edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeSchedulerJobs } = await import('@/lib/schedulerInit');
    initializeSchedulerJobs();
  }
}
