import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * ESLint 配置（flat config）
 *
 * 存在的理由：仓库原先只有 `pnpm --dir src/renderer run lint` 这个脚本，
 * 依赖也装了，但**没有配置文件** —— ESLint 9 直接报错退出，
 * 本地一道静态检查都没有。
 *
 * 规则来源是 eslint-plugin-sonarjs —— SonarCloud 扫 JS/TS 用的就是这套
 * SonarJS 规则（内部编号 S####）。本地跑它等于把 Sonar 的一部分
 * 提前搬到本地，不必等 CI 跑完才知道哪里有问题。
 *
 * 规则是**挑过的**，不是 sonarjs 推荐集全开：
 * 推荐集 230 条里有一大批是「代码异味」类的度量规则
 * （函数必须有显式返回类型、认知复杂度、行数上限），
 * 对本仓库来说只会刷屏、不会提升质量。
 * 这里只开**缺陷类与安全类**的规则 —— 与 SonarCloud 的 Bug / Vulnerability
 * 两个维度对得上。
 */

const SONAR_RECOMMENDED = sonarjs.configs.recommended.rules;

/** 要开的 SonarJS 规则（按类别分组，方便日后增删） */
const PICKED_SONAR_RULES = [
    // ---- 安全 ----
    'sonarjs/pseudo-random', // S2245 伪随机数当唯一 id / 口令
    'sonarjs/no-hardcoded-secrets', // S2068 硬编码密钥
    'sonarjs/hardcoded-secret-signatures',
    'sonarjs/no-hardcoded-passwords',
    'sonarjs/code-eval', // S1523 eval
    'sonarjs/no-os-command-from-path', // S4721 路径拼进命令
    'sonarjs/sql-queries', // S2077 字符串拼 SQL
    'sonarjs/weak-ssl',
    'sonarjs/no-weak-keys',
    'sonarjs/no-weak-cipher',
    'sonarjs/unverified-certificate',
    'sonarjs/unverified-hostname',
    'sonarjs/insecure-cookie',
    'sonarjs/cookie-no-httponly',
    'sonarjs/no-session-cookies-on-static-assets',
    'sonarjs/csrf',
    'sonarjs/cors',
    'sonarjs/xml-parser-xxe',
    'sonarjs/disabled-auto-escaping',
    'sonarjs/disabled-resource-integrity',
    'sonarjs/file-uploads',
    'sonarjs/file-permissions',
    'sonarjs/publicly-writable-directories',
    'sonarjs/no-hardcoded-ip',
    'sonarjs/content-security-policy',
    'sonarjs/no-mime-sniff',
    'sonarjs/no-referrer-policy',
    'sonarjs/strict-transport-security',
    'sonarjs/no-clear-text-protocols',
    'sonarjs/link-with-target-blank',
    'sonarjs/no-potentially-dangerous-fs-access', // S3267 文件系统访问
    'sonarjs/no-insecure-random',
    'sonarjs/no-try-promise',
    'sonarjs/no-ignored-exceptions',
    'sonarjs/no-ignored-return',
    'sonarjs/no-unthrown-error',

    // ---- 正则（回溯与字符类）----
    'sonarjs/slow-regex', // S5852 多行正则回溯
    'sonarjs/super-linear-regex', // S8786 超线性回溯
    'sonarjs/regex-complexity',
    'sonarjs/anchor-precedence',
    'sonarjs/no-misleading-character-class',
    'sonarjs/no-control-regex',
    'sonarjs/no-invalid-regexp',
    'sonarjs/no-empty-character-class',
    'sonarjs/stateful-regex',
    'sonarjs/no-empty-after-reluctant',
    'sonarjs/single-character-alternation',
    'sonarjs/no-useless-escape',

    // ---- 缺陷 ----
    'sonarjs/null-dereference',
    'sonarjs/no-array-delete',
    'sonarjs/different-types-comparison',
    'sonarjs/in-operator-type-error',
    'sonarjs/argument-type',
    'sonarjs/no-identical-expressions',
    'sonarjs/no-identical-conditions',
    'sonarjs/no-identical-functions',
    'sonarjs/no-duplicated-branches',
    'sonarjs/no-dead-store',
    'sonarjs/no-redundant-assignments',
    'sonarjs/no-useless-increment',
    'sonarjs/no-fallthrough',
    'sonarjs/no-equals-in-for-termination',
    'sonarjs/no-labels',
    'sonarjs/label-position',
    'sonarjs/function-inside-loop',
    'sonarjs/no-empty-collection',
    'sonarjs/no-unused-collection',
    'sonarjs/no-undefined-argument',
    'sonarjs/no-constant-binary-expression',
    'sonarjs/no-self-compare',
    'sonarjs/no-compare-against-zero',
    'sonarjs/no-collapsible-if',
    'sonarjs/no-sparse-arrays',
    'sonarjs/no-duplicate-string',
    'sonarjs/no-nested-conditional',
    'sonarjs/no-extra-arguments',
    'sonarjs/no-nested-functions',
    'sonarjs/no-implicit-global',
    'sonarjs/no-global-this',
    'sonarjs/block-scoped-var',
    'sonarjs/no-duplicate-string',
];

/**
 * 上面这份清单里有些规则名在 sonarjs v4 里已经改名或移除，
 * 对应能力改用 ESLint 核心规则补上（等价问题，不同规则号）。
 */
const CORE_RULES = {
    'no-self-compare': 'error', // 恒真/恒假的自我比较
    'no-var': 'error',
    'prefer-const': 'error',
    'use-isnan': 'error',
    'no-duplicate-case': 'error',
    'no-unsafe-finally': 'error',
    'no-await-in-loop': 'off', // S7051 是代码异味，本仓库里 await 循环是刻意的
    'no-sparse-arrays': 'error',
    'no-constant-binary-expression': 'error',
    'no-useless-escape': 'error',
    'no-shadow': 'off', // 阴影在 React 组件里太常见，是噪音
    'no-else-return': 'off', // 代码异味
    'no-lonely-if': 'error',
};

/**
 * 同样是代码异味（SonarCloud 那边算 smell，不进拦截级别），本地也不当错误。
 * 开着只会把真正的缺陷类问题淹掉 —— 一次能修的量就那么几十条。
 */
const SMELL_RULES_OFF = {
    'sonarjs/no-nested-conditional': 'off', // S1066
    'sonarjs/no-duplicate-string': 'off', // S1192
    'sonarjs/no-collapsible-if': 'off', // S1066
    'sonarjs/nested-control-flow': 'off',
    'sonarjs/prefer-single-boolean-return': 'off',
};

/**
 * typescript-eslint 的推荐规则集
 *
 * v8 里 `tseslint.configs.recommended` 是**数组**（每项一个配置对象），
 * 直接取 `.rules` 拿到的是 undefined —— 得摊平后再用。
 *
 * 这套规则要开：仓库里本来就有成片的
 * `// eslint-disable-next-line @typescript-eslint/no-explicit-any`，
 * 规则不开的话那些注释会被判成"失效的抑制指令"而被清理掉，
 * 等于把项目自己的约定给抹了。
 */
const tseslintRecommendedRules = Object.assign(
    {},
    ...tseslint.configs.recommended.map((config) => config.rules || {})
);

/** 挑出来的规则（推荐集里没有的直接丢掉） */
const sonarRules = Object.fromEntries(
    PICKED_SONAR_RULES.filter((name) => SONAR_RECOMMENDED[name]).map((name) => [
        name,
        SONAR_RECOMMENDED[name],
    ])
);

export default [
    {
        // 全局忽略 —— 必须单独成一个对象：flat config 里，
        // 与其它键写在同一个对象里的 ignores 只对那个配置块生效，不是全局忽略
        ignores: [
            'dist/**',
            'dist_electron/**',
            'node_modules/**',
            '**/node_modules/**',
            '**/coverage/**',
            '.data/**',
            'build/**',
            'src/renderer/src/**/*.css',
        ],
    },
    {
        // 仓库里有一批 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
        // 这类注释，是**有意留着的意图标记**（对应规则在本地是关的，
        // 关着的规则会让注释被判成"失效的抑制指令"）。
        // 报它们没意义 —— 真要治 any，另开一次专项。
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },

    // ---- TypeScript / TSX ----
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
            parserOptions: {
                // 类型感知的规则（null-dereference、different-types-comparison 等）需要它
                project: ['./tsconfig.lint.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            sonarjs,
            '@typescript-eslint': tseslint.plugin,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...tseslintRecommendedRules,
            ...sonarRules,
            ...CORE_RULES,
            ...SMELL_RULES_OFF,
            // 下划线开头的参数是有意留空的占位（如 BaseCallbackHandler 的钩子）
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            // any 在本仓库是刻意的（S4335 是代码异味，不是缺陷）——
            // 全仓 190 处，一次性改成 unknown 会把类型推导炸一遍，
            // 收益远小于风险。留着 off，真要治另开一次专项。
            '@typescript-eslint/no-explicit-any': 'off',
            // 同理：主进程里 require() 是为了按需加载可选依赖
            '@typescript-eslint/no-require-imports': 'off',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            // HMR 相关的限制在 Electron 多入口下不适用
            'react-refresh/only-export-components': 'off',
        },
    },

    // ---- 构建 / 发版脚本（普通 JS，跑在 Node 里）----
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: globals.node,
        },
        plugins: { sonarjs },
        rules: {
            ...sonarRules,
            ...CORE_RULES,
            ...SMELL_RULES_OFF,
            // 脚本里大量用 console 输出进度，js.configs.recommended 的
            // no-unused-vars 也会把「只在 catch 里打日志」的变量报出来
            'no-unused-vars': 'off',
            'no-undef': 'off',
        },
    },
];
