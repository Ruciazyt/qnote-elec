import { app } from "electron";
import * as path from "node:path";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// 容量上限与防递归都是硬性要求，不是可选项。
//
// 背景：早期实现既没有体积上限，也没有 stdout 断连保护。一次 EPIPE 被
// uncaughtException 捕获 → 日志函数 console.error 到已断开的管道 → 再次
// EPIPE → 无限自递归，一天把 app.log 刷到 9.4GB、app-error.log 刷到 9.3GB；
// 文件涨到这个量级后，写入开始间歇性返回 UNKNOWN(errno -4094)。
// 所以"写死了上限"和"写日志不会自己把自己写爆"必须同时成立。
// ---------------------------------------------------------------------------
const MAX_LOG_SIZE = 5 * 1024 * 1024; // app.log 单文件上限 5MB
const MAX_ERROR_SIZE = 2 * 1024 * 1024; // app-error.log 单文件上限 2MB
const MAX_BACKUP_COUNT = 3; // 保留 app.log.1 ~ app.log.3
const DUPLICATE_WINDOW_MS = 5000; // 相同日志的重复统计窗口
const DUPLICATE_LIMIT = 20; // 窗口内超过该次数的相同日志直接丢弃

let stdoutGuarded = false;

/**
 * 吞掉 stdout / stderr 的写错误。
 *
 * 开发环境的 stdout 接的是管道（concurrently / electron CLI / 终端），对端一关闭，
 * 任何 console.* 都会让 socket 触发 'error'。socket 没有 error listener 时，
 * Node 会把这个错误当成未捕获异常重新抛出；如果 uncaughtException 处理器再去调
 * 日志函数，就形成自递归 —— 那正是日志涨到 9.4GB 的原因。
 *
 * 因此必须显式挂 listener，且 handler 里不能再写 console（写了会再炸一次）。
 */
export function installStdoutGuard(): void {
    if (stdoutGuarded) return;
    stdoutGuarded = true;
    for (const stream of [process.stdout, process.stderr]) {
        stream?.on("error", () => {
            // 静默：管道已断，此刻没有任何"报告"动作是安全的。
        });
    }
}

// 模块加载即生效，早于任何一处日志调用。
installStdoutGuard();

/** console 的安全封装：日志系统自己不允许把异常抛回给调用方。 */
function safeConsole(level: "log" | "warn" | "error", message: string): void {
    try {
        console[level](message);
    } catch {
        // console 同步抛错（管道已断）同样不能冒泡，否则错误会回到调用栈里再被当成未捕获异常。
    }
}

// 创建日志系统
class Logger {
    private logFile: string;
    private errorLogFile: string;

    // 文件体积缓存：避免每写一条日志都 stat 一次。
    private logSize: number;
    private errorLogSize: number;

    // 重复日志抑制状态。
    private lastSignature: string;
    private windowStart: number;
    private repeated: number;
    private skipped: number;

    // 写失败只报告一次，避免错误日志本身也变成刷屏源。
    private writeFailed: boolean;

    constructor() {
        // 初始化时不立即创建文件，等待app准备好后再创建
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

    // 初始化日志文件路径
    initialize() {
        try {
            const logPath = app.getPath('userData');
            this.logFile = path.join(logPath, 'app.log');
            this.errorLogFile = path.join(logPath, 'app-error.log');

            // 确保日志目录存在
            fs.mkdirSync(path.dirname(this.logFile), { recursive: true });

            // 历史上没有上限时写出来的巨型文件直接截断：轮转成 app.log.1 依然是
            // 9GB 白占磁盘，只有截断才能真正把空间还回来。
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
            // 截断失败不阻断启动，后续写入仍按上限继续轮转。
        }
    }

    /** app.log.N 依次后移一位，当前文件挪成 .1，最老的直接丢弃。 */
    private rotate(filePath: string) {
        try {
            const oldest = `${filePath}.${MAX_BACKUP_COUNT}`;
            if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        } catch {
            // 轮转失败不阻断主流程
        }

        for (let i = MAX_BACKUP_COUNT - 1; i >= 1; i--) {
            try {
                if (fs.existsSync(`${filePath}.${i}`)) {
                    fs.renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`);
                }
            } catch {
                // 同上
            }
        }

        try {
            if (fs.existsSync(filePath)) {
                fs.renameSync(filePath, `${filePath}.1`);
            }
        } catch {
            // 同上
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
            // 写失败绝不能再 console.error 回去 —— 那正是自递归的起点之一。
            if (!this.writeFailed) {
                this.writeFailed = true;
                safeConsole('error', `写入日志文件 ${filePath} 失败（后续同类失败不再重复报告）: ${String(e)}`);
            }
        }
    }

    /** 输出到控制台与文件；line 已经是格式化好的完整日志行。 */
    private emit(level: "INFO" | "WARN" | "ERROR", line: string, toErrorFile: boolean) {
        const consoleLevel = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
        safeConsole(consoleLevel, line);
        this.writeToFile(this.logFile, line, MAX_LOG_SIZE, false);
        if (toErrorFile) {
            this.writeToFile(this.errorLogFile, line, MAX_ERROR_SIZE, true);
        }
    }

    /**
     * 同一窗口内出现次数超过 DUPLICATE_LIMIT 的相同日志直接丢弃。
     *
     * 有了容量上限之后，日志文件不会再撑爆磁盘；但一个高频循环仍然会持续
     * 刷控制台、吃满 CPU。异常处理器被高频误触发时就属于这种情况。
     * 被丢弃的条数会在离开窗口时补一条汇总，不留黑箱。
     */
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

    // 格式化日志消息
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
                    } catch (e) {
                        return '[无法序列化的对象]';
                    }
                } else {
                    return String(arg);
                }
            }).join(' ');
        }

        return formattedMessage;
    }

    // 日志级别方法
    info(message: string, ...args: any[]) {
        this.record('INFO', message, args, false);
    }

    warn(message: string, ...args: any[]) {
        this.record('WARN', message, args, false);
    }

    error(message: string, ...args: any[]) {
        this.record('ERROR', message, args, true);
    }

    // 记录错误对象
    logError(error: any) {
        this.error('应用程序错误', error);
    }
}

// 创建全局日志实例
export const log = new Logger();
