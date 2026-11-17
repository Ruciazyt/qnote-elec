
export interface Skill {
  id: string;
  name: string;
  content: string;
  category: string;
  isCustom: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const SKILL_CATEGORY = 'skill';

export const PLACEHOLDER_CONTENT = '{content}';
export const PLACEHOLDER_CLIPBOARD = '{clipboard}';

export const MAX_SKILL_NAME_LENGTH = 30;

export type SkillApplyMode = 'template' | 'system';

export interface SkillApplyInput {
  skillContent: string;
  userInput: string;
  clipboardContent?: string;
}

export interface SkillApplyResult {
  mode: SkillApplyMode;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  preview: string;
  missingPlaceholders: string[];
}

export function hasPlaceholders(content: string): boolean {
  return content.includes(PLACEHOLDER_CONTENT) || content.includes(PLACEHOLDER_CLIPBOARD);
}

export function applySkill(input: SkillApplyInput): SkillApplyResult {
  const { skillContent, userInput, clipboardContent } = input;

  if (!skillContent || !skillContent.trim()) {
    return {
      mode: 'system',
      messages: [{ role: 'user', content: userInput }],
      preview: userInput,
      missingPlaceholders: [],
    };
  }

  const missing: string[] = [];

  if (hasPlaceholders(skillContent)) {
    let filled = skillContent;

    if (filled.includes(PLACEHOLDER_CONTENT)) {
      if (userInput && userInput.trim()) {
        filled = filled.split(PLACEHOLDER_CONTENT).join(userInput);
      } else {
        missing.push(PLACEHOLDER_CONTENT);
      }
    }

    if (filled.includes(PLACEHOLDER_CLIPBOARD)) {
      if (clipboardContent && clipboardContent.trim()) {
        filled = filled.split(PLACEHOLDER_CLIPBOARD).join(clipboardContent);
      } else {
        missing.push(PLACEHOLDER_CLIPBOARD);
      }
    }

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

export function validateSkill(input: { name: string; content: string }): {
  valid: boolean;
  error?: string;
} {
  const name = (input.name || '').trim();
  const content = (input.content || '').trim();

  if (!name) {
    return { valid: false, error: '技能名不能为空' };
  }
  if (name.length > MAX_SKILL_NAME_LENGTH) {
    return { valid: false, error: `技能名过长（最多 ${MAX_SKILL_NAME_LENGTH} 字）` };
  }
  if (!content) {
    return { valid: false, error: '技能内容不能为空' };
  }

  return { valid: true };
}

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
