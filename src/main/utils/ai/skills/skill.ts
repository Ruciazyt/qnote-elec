/**
 * AI 技能（Skill）
 *
 * 数据落在现有的 template 表，用 category = 'skill' 做隔离
 * （不新建表 — template 表的 name/content/category 已经完全够用）
 *
 * 行为规则（自动判定，用户不用选）：
 *   - skill 内容里含 {content} 或 {clipboard} → **模板包裹**
 *     把占位符替换成实际内容，作为一条 user message 发给模型。
 *     例：`翻译成英文：{content}` + 用户输入「今天天气不错」
 *         → user: 「翻译成英文：今天天气不错」
 *
 *   - skill 内容里不含占位符 → **系统指令前置**
 *     作为一条 system message 注入，后续多轮持续生效。
 *     例：`你是一个专业翻译` + 用户输入「今天天气不错」
 *         → system: 「你是一个专业翻译」
 *           user:   「今天天气不错」
 *
 * 支持的占位符：
 *   - {content}  用户在对话框输入的文字
 *   - {clipboard}  剪贴板最新一条内容
 */

export interface Skill {
  id: string;
  name: string;
  /** skill 的 prompt 文本，可能含 {content} / {clipboard} */
  content: string;
  category: string;
  isCustom: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** skill 分类常量 — 与 template 表的 category 字段对应 */
export const SKILL_CATEGORY = 'skill';

/** 占位符常量 */
export const PLACEHOLDER_CONTENT = '{content}';
export const PLACEHOLDER_CLIPBOARD = '{clipboard}';

/** skill 内容长度上限（防止用户写超长 prompt 撑爆 context） */
export const MAX_SKILL_CONTENT_LENGTH = 4000;

export type SkillApplyMode = 'template' | 'system';

export interface SkillApplyInput {
  /** skill 的 prompt 内容 */
  skillContent: string;
  /** 用户在对话框输入的文字 */
  userInput: string;
  /** 剪贴板最新一条内容（可为 undefined） */
  clipboardContent?: string;
}

export interface SkillApplyResult {
  /** 应用方式 */
  mode: SkillApplyMode;
  /** 最终发给模型的消息序列（按时间正序） */
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  /** 替换后的人类可读预览（调试用） */
  preview: string;
  /** 未被替换的占位符（提醒用户该变量没值） */
  missingPlaceholders: string[];
}

/**
 * 判断 skill 内容里是否含占位符
 */
export function hasPlaceholders(content: string): boolean {
  return content.includes(PLACEHOLDER_CONTENT) || content.includes(PLACEHOLDER_CLIPBOARD);
}

/**
 * 把 skill 应用到一次对话上
 *
 * @param input.skillContent   skill 的 prompt 文本
 * @param input.userInput      用户输入
 * @param input.clipboardContent 剪贴板最新内容（可选）
 */
export function applySkill(input: SkillApplyInput): SkillApplyResult {
  const { skillContent, userInput, clipboardContent } = input;

  // skill 为空 → 不生效
  if (!skillContent || !skillContent.trim()) {
    return {
      mode: 'system',
      messages: [{ role: 'user', content: userInput }],
      preview: userInput,
      missingPlaceholders: [],
    };
  }

  const missing: string[] = [];

  // 方式 B：含占位符 → 模板包裹
  if (hasPlaceholders(skillContent)) {
    let filled = skillContent;

    // 替换 {content} — 用户没输入时标记为缺失
    if (filled.includes(PLACEHOLDER_CONTENT)) {
      if (userInput && userInput.trim()) {
        filled = filled.split(PLACEHOLDER_CONTENT).join(userInput);
      } else {
        missing.push(PLACEHOLDER_CONTENT);
      }
    }

    // 替换 {clipboard} — 没有剪贴板内容时标记为缺失
    if (filled.includes(PLACEHOLDER_CLIPBOARD)) {
      if (clipboardContent && clipboardContent.trim()) {
        filled = filled.split(PLACEHOLDER_CLIPBOARD).join(clipboardContent);
      } else {
        missing.push(PLACEHOLDER_CLIPBOARD);
      }
    }

    // 用户输入没被 {content} 吃掉时，补在后面（避免用户白打）
    // 判定：填充后如果还看不到用户输入的任何片段，且用户确实输入了内容
    if (
      userInput &&
      userInput.trim() &&
      !skillContent.includes(PLACEHOLDER_CONTENT) &&
      clipboardContent &&
      !filled.includes(userInput.slice(0, 20))
    ) {
      filled = `${filled}\n\n${userInput}`;
    }

    return {
      mode: 'template',
      messages: [{ role: 'user', content: filled }],
      preview: filled,
      missingPlaceholders: missing,
    };
  }

  // 方式 A：无占位符 → 系统指令前置
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: skillContent.trim() },
  ];
  if (userInput && userInput.trim()) {
    messages.push({ role: 'user', content: userInput });
  }

  return {
    mode: 'system',
    messages,
    preview: skillContent.trim(),
    missingPlaceholders: [],
  };
}

/**
 * 校验 skill 输入
 */
export function validateSkill(input: { name: string; content: string }): {
  valid: boolean;
  error?: string;
} {
  const name = (input.name || '').trim();
  const content = (input.content || '').trim();

  if (!name) {
    return { valid: false, error: '技能名不能为空' };
  }
  if (name.length > 30) {
    return { valid: false, error: '技能名过长（最多 30 字）' };
  }
  if (!content) {
    return { valid: false, error: '技能内容不能为空' };
  }
  if (content.length > MAX_SKILL_CONTENT_LENGTH) {
    return {
      valid: false,
      error: `技能内容过长（最多 ${MAX_SKILL_CONTENT_LENGTH} 字）`,
    };
  }

  return { valid: true };
}

/**
 * 生成 skill 模板示例（给设置页的「插入示例」按钮用）
 */
export const SKILL_EXAMPLES: Array<{ name: string; content: string; hint: string }> = [
  {
    name: '翻译成英文',
    content: '把以下内容翻译成英文，保持原意，只输出译文：\n\n{content}',
    hint: '用 {content} 占位你的输入（模板包裹）',
  },
  {
    name: '润色中文',
    content: '你是一个中文写作助手。把用户输入润色成更流畅专业的表达，保持原意和长度，不要添加新内容。',
    hint: '不含占位符 → 作为系统指令持续生效',
  },
  {
    name: '总结剪贴板',
    content: '用三句话总结以下内容的核心观点：\n\n{clipboard}',
    hint: '用 {clipboard} 占位剪贴板内容',
  },
  {
    name: '写 commit message',
    content:
      '根据以下代码变更，生成一条 Conventional Commits 格式的提交信息（只输出信息本身，不要代码块标记）：\n\n{clipboard}',
    hint: '对剪贴板里的 diff 生成提交信息',
  },
  {
    name: '提取待办',
    content: '从以下内容中提取出待办事项，每行一条，不要编号：\n\n{clipboard}',
    hint: '把剪贴板内容里的事项提成待办',
  },
];
