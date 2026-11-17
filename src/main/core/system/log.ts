import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_ERROR_SIZE = 2 * 1024 * 1024;
const MAX_BACKUP_COUNT = 3;
const DUPLICATE_WINDOW_MS = 5000;
const DUPLICATE_LIMIT = 20;

const STDOUT_GUARDED: unique symbol = Symbol.for("qnote.stdoutGuarded");

type GuardedStream = NodeJS.WriteStream & { [STDOUT_GUARDED]?: boolean };

export function installStdoutGuard(): void {
    for (const stream of [process.stdout, process.stderr] as GuardedStream[]) {
        if (!stream || stream[STDOUT_GUARDED]) continue;
        stream[STDOUT_GUARDED] = true;
        stream.on("error", () => {
        });
    }
}

installStdoutGuard();

function safeConsole(level: "log" | "warn" | "error", message: string): void {
    try {
        console[level](message);
    } catch {
    }
}

class Logger {
    private logFile: string;
    private errorLogFile: string;

    private logSize: number;
    private errorLogSize: number;

    private lastSignature: string;
    private windowStart: number;
    private repeated: number;
    private skipped: number;

    private writeFailed: boolean;

    constructor() {
        this.logFile = '';
        this.errorLogFile = '';
        this.logSize = 0;
        this.errorLogSize = 0;
        this.lastSignature = '';
        this.windowStart = 0;
        this.repeated = 0;
        this.skipped = 0;
        this.writeFailed = false;
    }

    initialize() {
        try {
            const logPath = app.getPath('userData');
            this.logFile = path.join(logPath, 'app.log');
            this.errorLogFile = path.join(logPath, 'app-error.log');

            fs.mkdirSync(path.dirname(this.logFile), { recursive: true });

            this.truncateIfOversized(this.logFile, MAX_LOG_SIZE);
            this.truncateIfOversized(this.errorLogFile, MAX_ERROR_SIZE);

            this.logSize = this.sizeOf(this.logFile);
            this.errorLogSize = this.sizeOf(this.errorLogFile);

            this.info('日志系统初始化完成', {
                logFile: this.logFile,
                errorLogFile: this.errorLogFile,
                maxSizeBytes: MAX_LOG_SIZE,
                maxBackupCount: MAX_BACKUP_COUNT,
            });
        } catch (e) {
            safeConsole('error', `初始化日志系统失败: ${String(e)}`);
        }
    }

    private sizeOf(filePath: string): number {
        try {
            return fs.statSync(filePath).size;
        } catch {
            return 0;
        }
    }

    private truncateIfOversized(filePath: string, maxSize: number) {
        try {
            const size = this.sizeOf(filePath);
            if (size <= maxSize) return;
            fs.truncateSync(filePath, 0);
            safeConsole('warn', `日志文件 ${filePath} 已达 ${(size / 1024 / 1024).toFixed(1)}MB，超过上限 ${(maxSize / 1024 / 1024).toFixed(1)}MB，已重置`);
        } catch {
        }
    }

    private rotate(filePath: string) {
        try {
            const oldest = `${filePath}.${MAX_BACKUP_COUNT}`;
            if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        } catch {
        }

        for (let i = MAX_BACKUP_COUNT - 1; i >= 1; i--) {
            try {
                if (fs.existsSync(`${filePath}.${i}`)) {
                    fs.renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`);
                }
            } catch {
            }
        }

        try {
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, `${filePath}.1`);
            }
        } catch {
        }
    }

    private writeToFile(filePath: string, message: string, maxSize: number, isErrorFile: boolean) {
        if (!filePath) return;
        const chunk = message + '\n';
        const bytes = Buffer.byteLength(chunk, 'utf8');
        try {
            let size = isErrorFile ? this.errorLogSize : this.logSize;
            if (size + bytes > maxSize) {
                this.rotate(filePath);
                size = 0;
            }
            fs.appendFileSync(filePath, chunk, 'utf8');
            size += bytes;
            if (isErrorFile) {
                this.errorLogSize = size;
            } else {
                this.logSize = size;
            }
            this.writeFailed = false;
        } catch (e) {
            if (!this.writeFailed) {
                this.writeFailed = true;
                safeConsole('error', `写入日志文件 ${filePath} 失败（后续同类失败不再重复报告）: ${String(e)}`);
            }
        }
    }

    private emit(level: "INFO" | "WARN" | "ERROR", line: string, toErrorFile: boolean) {
        const consoleLevel = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
        safeConsole(consoleLevel, line);
        this.writeToFile(this.logFile, line, MAX_LOG_SIZE, false);
        if (toErrorFile) {
            this.writeToFile(this.errorLogFile, line, MAX_ERROR_SIZE, true);
        }
    }

    private record(level: "INFO" | "WARN" | "ERROR", message: string, args: any[], toErrorFile: boolean) {
        const now = Date.now();
        const signature = `${level}|${message}`;
        const sameWindow = signature === this.lastSignature && now - this.windowStart <= DUPLICATE_WINDOW_MS;

        if (!sameWindow) {
            if (this.skipped > 0) {
                const previous = this.lastSignature.slice(this.lastSignature.indexOf('|') + 1);
                this.emit(level, `[${new Date(this.windowStart).toISOString()}] [${level}] ${previous} —— 同一窗口内重复 ${this.skipped} 次，已省略`, toErrorFile);
            }
            this.lastSignature = signature;
            this.windowStart = now;
            this.repeated = 0;
            this.skipped = 0;
        }

        this.repeated++;
        if (this.repeated > DUPLICATE_LIMIT) {
            this.skipped++;
            return;
        }

        this.emit(level, this.formatMessage(level, message, args), toErrorFile);
    }

    private formatMessage(level: string, message: string, args: any[]): string {
        const timestamp = new Date().toISOString();
        let formattedMessage = `[${timestamp}] [${level}] ${message}`;

        if (args.length > 0) {
            formattedMessage += ' ' + args.map(arg => {
                if (arg instanceof Error) {
                    return `${arg.message}\n${arg.stack || ''}`;
                } else if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg);
                    } catch {
                        return '[无法序列化的对象]';
                    }
                } else {
                    return String(arg);
                }
            }).join(' ');
        }

        return formattedMessage;
    }

    info(message: string, ...args: any[]) {
        this.record('INFO', message, args, false);
    }

    warn(message: string, ...args: any[]) {
        this.record('WARN', message, args, false);
    }

    error(message: string, ...args: any[]) {
        this.record('ERROR', message, args, true);
    }

    logError(error: any) {
        this.error('应用程序错误', error);
    }
}

export const log = new Logger();
