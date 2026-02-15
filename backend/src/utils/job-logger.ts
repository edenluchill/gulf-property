/**
 * Job Logger Utility
 *
 * Saves job logs to local files (dev environment only)
 * Captures console output during job execution
 *
 * ⭐ Optimized: Filters verbose messages to keep logs concise
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const isDev = process.env.NODE_ENV !== 'production';
const OUTPUT_BASE_DIR = join(process.cwd(), 'uploads', 'langgraph-output');

// Active loggers by jobId
const activeLoggers = new Map<string, JobLogger>();

/**
 * Patterns to filter out (too verbose, not useful for debugging)
 */
const VERBOSE_PATTERNS: RegExp[] = [
  /^📤 Sent event to/,                    // SSE events (too frequent)
  /^📋 Task .* status updated to/,        // Task status updates (repetitive)
  /^🔄 Skipping duplicate image/,         // Duplicate image warnings (noisy)
  /^✅ Using \d+ pre-generated images/,   // Repeated per chunk
  /^🔄 Analyzing \d+ pages in parallel/,  // Repeated per chunk
  /^Units from workflow: \d+$/,           // Repeated in merge logs
  /^💰 Payment plans: \d+$/,              // Repeated
  /^🏗️\s+Project info merged:/,          // Repeated
  /^🏊 Amenities merged:/,                // Repeated
  /^\s+- (Master Plans|Location Maps|Cover|Aerial):/,  // Repeated stats
  /^\[.*\] ✓ Extracted project images/,  // Repeated
  /^📑 Section start:/,                   // Per-page section markers
  /^🖼️\s+Project images merged:/,        // Repeated
  /^🖼️\s+All images merged:/,            // Repeated
  /^✅ Connected to PostgreSQL/,          // DB connection (once is enough)
  /^\s*$/,                                // Empty lines
];

/**
 * Messages to always keep (important milestones)
 */
const IMPORTANT_PATTERNS: RegExp[] = [
  /^={10,}/,                              // Separator lines
  /^📋 PDF PROCESSING/,                   // Workflow start
  /^✅ WORKFLOW COMPLETED/,               // Workflow end
  /^❌/,                                  // Errors
  /^⚠️.*area=0/,                         // Important warnings
  /^💰.*Matched pricing/,                 // Pricing matches
  /^💵 Extracted \d+ pricing/,            // Pricing extraction success
  /^🏢.*Building context/,                // Building context for pricing
  /^📊 Final Summary/,                    // Final results
  /^✅ Batch processing complete/,        // Batch completion
  /unit_anchor.*scheduling extraction/,   // Unit detection
  /^   ✓ Found unit/,                     // Unit boundaries
  /^   📝 Updated page/,                  // Page updates (area fix)
  /^   🔄 Combined/,                      // Name combination
  /^📊 Boundary scan complete/,           // Boundary results
  /pricing_table/i,                       // Pricing table classification
  /^   ✓ Matched/,                        // Successful matches
  /^   ⚠️  No workflow data/,             // Missing data warnings
  /^✨ Generating intelligent/,           // AI description generation
  /^Job ID:/,                             // Job info
  /^Files:/,                              // File info
  /Total pages:/,                         // Page count
  /^✅ Merged \d+ units/,                 // Merge results
];

export class JobLogger {
  private logPath: string;
  private startTime: number;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;
  private lastMessage: string = '';       // For deduplication
  private duplicateCount: number = 0;     // Count consecutive duplicates

  constructor(jobId: string) {
    this.startTime = Date.now();
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;

    // Save log in job output directory
    const jobDir = join(OUTPUT_BASE_DIR, jobId);
    if (!existsSync(jobDir)) {
      mkdirSync(jobDir, { recursive: true });
    }

    // Log filename: job-log-{jobId}.log
    this.logPath = join(jobDir, `job-log-${jobId}.log`);

    // Write header
    this.writeToFile(`${'='.repeat(80)}\n`);
    this.writeToFile(`JOB LOG: ${jobId}\n`);
    this.writeToFile(`Started: ${new Date().toISOString()}\n`);
    this.writeToFile(`${'='.repeat(80)}\n\n`);
  }

  /**
   * Start capturing console output
   */
  startCapture(): void {
    if (!isDev) return;

    const self = this;

    console.log = function (...args: any[]) {
      self.originalConsoleLog.apply(console, args);
      self.log('LOG', args);
    };

    console.error = function (...args: any[]) {
      self.originalConsoleError.apply(console, args);
      self.log('ERROR', args);
    };

    console.warn = function (...args: any[]) {
      self.originalConsoleWarn.apply(console, args);
      self.log('WARN', args);
    };
  }

  /**
   * Stop capturing and restore original console
   */
  stopCapture(): void {
    if (!isDev) return;

    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;

    // Flush any remaining duplicates
    this.flushDuplicates();

    // Write footer
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    this.writeToFile(`\n${'='.repeat(80)}\n`);
    this.writeToFile(`JOB COMPLETED\n`);
    this.writeToFile(`Duration: ${duration}s\n`);
    this.writeToFile(`Ended: ${new Date().toISOString()}\n`);
    this.writeToFile(`Log saved to: ${this.logPath}\n`);
    this.writeToFile(`${'='.repeat(80)}\n`);

    this.originalConsoleLog(`📝 Job log saved to: ${this.logPath}`);
  }

  /**
   * Log a message to file (with filtering)
   */
  private log(level: string, args: any[]): void {
    const timestamp = new Date().toISOString().substring(11, 23); // HH:MM:SS.mmm
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // ⭐ Always log errors and warnings
    if (level === 'ERROR' || level === 'WARN') {
      this.writeToFile(`[${timestamp}] [${level}] ${message}\n`);
      return;
    }

    // ⭐ Check if message matches important patterns (always log)
    const isImportant = IMPORTANT_PATTERNS.some(pattern => pattern.test(message));
    if (isImportant) {
      this.flushDuplicates();
      this.writeToFile(`[${timestamp}] [${level}] ${message}\n`);
      this.lastMessage = message;
      return;
    }

    // ⭐ Filter out verbose patterns
    const isVerbose = VERBOSE_PATTERNS.some(pattern => pattern.test(message));
    if (isVerbose) {
      return; // Skip verbose messages
    }

    // ⭐ Deduplicate consecutive identical messages
    if (message === this.lastMessage) {
      this.duplicateCount++;
      return; // Don't log duplicate
    }

    // Flush any pending duplicates
    this.flushDuplicates();

    // Log the new message
    this.writeToFile(`[${timestamp}] [${level}] ${message}\n`);
    this.lastMessage = message;
  }

  /**
   * Flush duplicate count if any
   */
  private flushDuplicates(): void {
    if (this.duplicateCount > 0) {
      const timestamp = new Date().toISOString().substring(11, 23);
      this.writeToFile(`[${timestamp}] [LOG]    ... (repeated ${this.duplicateCount} more times)\n`);
      this.duplicateCount = 0;
    }
  }

  /**
   * Write to log file
   */
  private writeToFile(content: string): void {
    try {
      appendFileSync(this.logPath, content);
    } catch (err) {
      // Silently fail if we can't write
    }
  }

  /**
   * Get log file path
   */
  getLogPath(): string {
    return this.logPath;
  }
}

/**
 * Start logging for a job (dev only)
 */
export function startJobLogging(jobId: string): JobLogger | null {
  if (!isDev) return null;

  const logger = new JobLogger(jobId);
  logger.startCapture();
  activeLoggers.set(jobId, logger);

  return logger;
}

/**
 * Stop logging for a job
 */
export function stopJobLogging(jobId: string): string | null {
  if (!isDev) return null;

  const logger = activeLoggers.get(jobId);
  if (logger) {
    logger.stopCapture();
    activeLoggers.delete(jobId);
    return logger.getLogPath();
  }

  return null;
}

/**
 * Get active logger for a job
 */
export function getJobLogger(jobId: string): JobLogger | null {
  return activeLoggers.get(jobId) || null;
}
