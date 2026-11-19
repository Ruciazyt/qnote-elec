import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import qnote from './scripts/quality/eslint-rules/index.mjs';


const SONAR_RECOMMENDED = sonarjs.configs.recommended.rules;

const PICKED_SONAR_RULES = [
    'sonarjs/pseudo-random',
    'sonarjs/no-hardcoded-secrets',
    'sonarjs/hardcoded-secret-signatures',
    'sonarjs/no-hardcoded-passwords',
    'sonarjs/code-eval',
    'sonarjs/no-os-command-from-path',
    'sonarjs/os-command',
    'sonarjs/hashing',
    'sonarjs/encryption-secure-mode',
    'sonarjs/insecure-jwt-token',
    'sonarjs/confidential-information-logging',
    'sonarjs/no-mixed-content',
    'sonarjs/web-sql-database',
    'sonarjs/post-message',
    'sonarjs/dynamically-constructed-templates',
    'sonarjs/no-intrusive-permissions',
    'sonarjs/production-debug',
    'sonarjs/no-unsafe-unzip',
    'sonarjs/sql-queries',
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
    'sonarjs/no-potentially-dangerous-fs-access',
    'sonarjs/no-insecure-random',
    'sonarjs/no-try-promise',
    'sonarjs/no-ignored-exceptions',
    'sonarjs/no-ignored-return',
    'sonarjs/no-unthrown-error',

    'sonarjs/slow-regex',
    'sonarjs/super-linear-regex',
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

const CORE_RULES = {
    'no-self-compare': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'use-isnan': 'error',
    'no-duplicate-case': 'error',
    'no-unsafe-finally': 'error',
    'no-await-in-loop': 'off',
    'no-sparse-arrays': 'error',
    'no-constant-binary-expression': 'error',
    'no-useless-escape': 'error',
    'no-shadow': 'off',
    'no-else-return': 'off',
    'no-lonely-if': 'error',
};

const SMELL_RULES_OFF = {
    'sonarjs/no-nested-conditional': 'off',
    'sonarjs/no-duplicate-string': 'off',
    'sonarjs/no-collapsible-if': 'off',
    'sonarjs/nested-control-flow': 'off',
    'sonarjs/prefer-single-boolean-return': 'off',
};

const tseslintRecommendedRules = Object.assign(
    {},
    ...tseslint.configs.recommended.map((config) => config.rules || {})
);

const sonarRules = Object.fromEntries(
    PICKED_SONAR_RULES.filter((name) => SONAR_RECOMMENDED[name]).map((name) => [
        name,
        SONAR_RECOMMENDED[name],
    ])
);

export default [
    {
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
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },

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
                project: ['./tsconfig.lint.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            sonarjs,
            qnote,
            '@typescript-eslint': tseslint.plugin,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...tseslintRecommendedRules,
            ...sonarRules,
            ...CORE_RULES,
            ...SMELL_RULES_OFF,
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'react-refresh/only-export-components': 'off',
            'qnote/directory-layout': 'error',
            'qnote/no-manual-runtime-path': 'error',
            'qnote/preload-no-shared-import': 'error',
            'qnote/no-direct-database-import': 'error',
            'qnote/no-arbitrary-duration': 'error',
            'qnote/no-module-state-in-utils': 'error',
        },
    },

    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: globals.node,
        },
        plugins: { sonarjs, qnote },
        rules: {
            ...sonarRules,
            ...CORE_RULES,
            ...SMELL_RULES_OFF,
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'qnote/directory-layout': 'error',
        },
    },

    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node,
        },
        plugins: { qnote },
        rules: {
            'qnote/directory-layout': 'error',
        },
    },
];
