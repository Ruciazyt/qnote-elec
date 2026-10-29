import prettier from "prettier/standalone";
import parserBabel from "prettier/plugins/babel";
import parserTypeScript from "prettier/plugins/typescript";
import parserEstree from "prettier/plugins/estree";
import parserHtml from "prettier/plugins/html";
import parserPostCSS from "prettier/plugins/postcss";

/**
 * 支持的编程语言类型
 */
export type SupportedLanguage = "javascript" | "typescript" | "json" | "html" | "css";

/**
 * 语言到 Prettier parser 的映射
 */
type ParserConfig = { parser: string; plugins: any[] };

const languageParserMap: Record<string, ParserConfig> = {
    javascript: {
        parser: "babel",
        plugins: [parserBabel, parserEstree],
    },
    typescript: {
        parser: "typescript",
        plugins: [parserTypeScript, parserEstree],
    },
    json: {
        parser: "json",
        plugins: [parserBabel, parserEstree],
    },
    html: {
        parser: "html",
        plugins: [parserHtml, parserEstree],
    },
    css: {
        parser: "css",
        plugins: [parserPostCSS, parserEstree],
    },
};

/**
 * 格式化代码
 * @param content 原始代码内容
 * @param language 编程语言
 * @returns 格式化后的代码
 */
export async function formatCode(
    content: string,
    language: SupportedLanguage
): Promise<string> {
    if (!content.trim()) {
        return content;
    }

    try {
        const config = languageParserMap[language];
        if (!config) {
            throw new Error(`不支持的语言: ${language}`);
        }

        // 使用 Prettier 格式化
        const formatted = await prettier.format(content, {
            parser: config.parser,
            plugins: config.plugins,
            // 使用默认配置，可以根据需要调整
            printWidth: 80,
            tabWidth: 2,
            useTabs: false,
            semi: true,
            singleQuote: false,
            trailingComma: "es5",
        });

        return formatted;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`格式化失败: ${errorMessage}`);
    }
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): Array<{ value: SupportedLanguage; label: string }> {
    return [
        { value: "javascript", label: "JavaScript" },
        { value: "typescript", label: "TypeScript" },
        { value: "json", label: "JSON" },
        { value: "html", label: "HTML" },
        { value: "css", label: "CSS" },
    ];
}
