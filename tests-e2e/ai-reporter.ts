import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join } from 'path';

interface FailureInfo {
  test: TestCase;
  result: TestResult;
  swLogPath?: string;
  swLogContent?: string;
}

/**
 * AI-optimized reporter that outputs:
 * 1. High-level summary to console (for AI agents reading console)
 * 2. Detailed debug files with full context
 * 3. File paths (not GUI commands) for AI to read files directly
 */
class AIReporter implements Reporter {
  private failures: FailureInfo[] = [];
  private runDir: string;

  constructor() {
    // Use the same run directory as Playwright config
    this.runDir =
      process.env.INTENDER_TEST_RUN_DIR ||
      join(process.cwd(), '.test-results', 'latest');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed') return;

    // Find SW log attachment if present
    const swLogAttachment = result.attachments.find(
      a => a.name === 'service-worker-logs'
    );

    // Try to find SW log file from winston logger
    let swLogPath: string | undefined;
    let swLogContent: string | undefined;

    if (process.env.TEST_SW_LOG) {
      const logDir = join(this.runDir, 'logs');
      try {
        // First try with basename if available
        const basename = process.env.INTENDER_SW_LOG_BASENAME;
        if (basename) {
          swLogPath = join(logDir, `sw-background.${basename}`);
          try {
            swLogContent = readFileSync(swLogPath, 'utf-8');
          } catch {
            // File not found with exact basename, continue to search
          }
        }

        // If not found, search for log files matching test name
        if (!swLogContent) {
          try {
            const files = readdirSync(logDir);
            const testNameSlug = test.title
              .replace(/[^a-zA-Z0-9-_]/g, '_')
              .substring(0, 50);

            // Try multiple matching strategies
            let matchingFile = files.find(f => {
              const lowerF = f.toLowerCase();
              const lowerTest = testNameSlug.toLowerCase();
              return (
                lowerF.includes(lowerTest) ||
                lowerF.includes(
                  test.title.toLowerCase().replace(/[^a-z0-9]/g, '_')
                ) ||
                (basename &&
                  lowerF.includes(basename.split(' - ')[0].toLowerCase()))
              );
            });

            // If still no match, try matching by project name and test file
            if (!matchingFile) {
              const projectName = test.parent.project()?.name || '';
              const fileName =
                test.location.file.split('/').pop()?.replace('.spec.ts', '') ||
                '';
              matchingFile = files.find(f => {
                const lowerF = f.toLowerCase();
                return (
                  lowerF.includes(projectName.toLowerCase()) &&
                  lowerF.includes(fileName.toLowerCase())
                );
              });
            }

            // Last resort: get most recent log file
            if (!matchingFile && files.length > 0) {
              const filesWithStats = files
                .map(f => ({
                  name: f,
                  path: join(logDir, f),
                  mtime: statSync(join(logDir, f)).mtime.getTime(),
                }))
                .sort((a, b) => b.mtime - a.mtime);
              matchingFile = filesWithStats[0]?.name;
            }

            if (matchingFile) {
              swLogPath = join(logDir, matchingFile);
              swLogContent = readFileSync(swLogPath, 'utf-8');
            }
          } catch {
            // Couldn't find log file, will use attachment if available
          }
        }
      } catch {
        // Log directory might not exist
      }
    }

    // If we have inline attachment with actual content, prefer that
    if (swLogAttachment?.body) {
      const attachmentContent = swLogAttachment.body.toString();
      // Only use attachment if it has actual content (not error message)
      if (
        attachmentContent &&
        !attachmentContent.includes('Could not access') &&
        attachmentContent.trim().length > 0
      ) {
        swLogContent = attachmentContent;
      }
    }

    this.failures.push({
      test,
      result,
      swLogPath,
      swLogContent,
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    if (this.failures.length === 0) return;

    // Ensure debug directory exists
    const debugDir = join(this.runDir, 'ai-debug');
    mkdirSync(debugDir, { recursive: true });

    // Output console summary for AI agents
    console.log('\n' + '='.repeat(70));
    console.log('AI DEBUG SUMMARY');
    console.log('='.repeat(70));

    for (const { test, result: testResult, swLogPath, swLogContent } of this
      .failures) {
      const sanitizedTitle = this.sanitize(test.title);
      const debugFile = join(debugDir, `${sanitizedTitle}.txt`);

      // Extract error message (first line, strip ANSI codes)
      const errorMessage = this.stripAnsi(
        testResult.error?.message?.split('\n')[0] || 'Unknown error'
      );

      // Extract last few SW log lines for quick context
      const lastSwLogs = swLogContent
        ? swLogContent
            .split('\n')
            .filter(line => line.trim().length > 0)
            .slice(-5)
            .map(line => line.trim())
        : [];

      // Console output: High-level summary
      console.log(`\n❌ FAILED: ${test.title}`);
      console.log(`   Location: ${test.location.file}:${test.location.line}`);
      console.log(`   Error: ${errorMessage}`);
      console.log(`   Status: ${testResult.status}`);
      console.log(`   Duration: ${Math.round(testResult.duration)}ms`);

      if (lastSwLogs.length > 0) {
        console.log(`   Last SW logs:`);
        lastSwLogs.forEach(line => console.log(`     ${line}`));
      }

      if (swLogPath) {
        console.log(`   📄 SW log file: ${swLogPath}`);
      }

      console.log(`   📄 Full debug: ${debugFile}`);

      // Write detailed debug file
      const fullDebug = this.buildDebugFileContent(
        test,
        testResult,
        swLogContent,
        swLogPath
      );
      writeFileSync(debugFile, fullDebug);
    }

    console.log('\n' + '='.repeat(70));
    console.log(
      `Summary: ${this.failures.length} test(s) failed. Debug files written to: ${debugDir}`
    );
    console.log('='.repeat(70) + '\n');
  }

  /**
   * Strips ANSI color codes from text
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*m/g, '');
  }

  private buildDebugFileContent(
    test: TestCase,
    result: TestResult,
    swLogContent?: string,
    swLogPath?: string
  ): string {
    const lines: string[] = [];

    lines.push(`TEST: ${test.title}`);
    lines.push(`FILE: ${test.location.file}:${test.location.line}`);
    lines.push(`PROJECT: ${test.parent.project()?.name || 'unknown'}`);
    lines.push(`STATUS: ${result.status}`);
    lines.push(`DURATION: ${Math.round(result.duration)}ms`);
    lines.push(`RETRY: ${result.retry}`);
    lines.push('');

    // Error details (strip ANSI codes)
    if (result.error) {
      lines.push('ERROR MESSAGE:');
      lines.push(this.stripAnsi(result.error.message || 'None'));
      lines.push('');
      lines.push('STACK TRACE:');
      lines.push(this.stripAnsi(result.error.stack || 'None'));
      lines.push('');
    }

    // Standard output
    if (result.stdout.length > 0) {
      lines.push('STDOUT:');
      lines.push(result.stdout.join('\n'));
      lines.push('');
    }

    // Standard error
    if (result.stderr.length > 0) {
      lines.push('STDERR:');
      lines.push(result.stderr.join('\n'));
      lines.push('');
    }

    // Service worker logs
    if (swLogContent) {
      lines.push('SERVICE WORKER LOGS:');
      lines.push('─'.repeat(70));
      lines.push(swLogContent);
      lines.push('─'.repeat(70));
      lines.push('');
    } else if (swLogPath) {
      lines.push('SERVICE WORKER LOGS:');
      lines.push(`(Log file exists but could not be read: ${swLogPath})`);
      lines.push('');
    } else {
      lines.push('SERVICE WORKER LOGS:');
      lines.push('(Not captured - TEST_SW_LOG may not be enabled)');
      lines.push('');
    }

    // Attachments
    if (result.attachments.length > 0) {
      lines.push('ATTACHMENTS:');
      result.attachments.forEach(att => {
        lines.push(`- ${att.name}: ${att.path || '[inline]'}`);
        if (att.contentType) {
          lines.push(`  Content-Type: ${att.contentType}`);
        }
      });
      lines.push('');
    }

    // Test annotations
    if (test.annotations.length > 0) {
      lines.push('ANNOTATIONS:');
      test.annotations.forEach(ann => {
        lines.push(`- ${ann.type}: ${ann.description || ''}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  private sanitize(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 100);
  }
}

export default AIReporter;
