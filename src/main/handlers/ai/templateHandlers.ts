import { ipcMain, IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { log } from "../../core/system/log";
import { SKILL_CATEGORY, validateSkill } from "../../core/ai/skills/index";
import { fetchSkillPreview } from "../../core/ai/skills/importer";

export function registerTemplateHandlers(DB: any) {
  ipcMain.handle("get-templates", async () => {
    try {
      const templates = await DB.from("template").select("*").orderBy("name", "asc");

      return templates.map((template: any) => ({
        id: template.id,
        name: template.name,
        content: template.content,
        category: template.category,
        isCustom: template.is_custom,
        createdAt: template.created_at,
        updatedAt: template.updated_at,
      }));
    } catch (err) {
      log.error("获取模板失败", err);
      return [];
    }
  });

  ipcMain.handle(
    "save-template",
    async (
      event: IpcMainInvokeEvent,
      template: {
        id: string;
        name: string;
        content: string;
        category: string;
        isCustom?: boolean;
      }
    ) => {
      try {
        const now = new Date();

        const existingTemplate = await DB.from("template").select("*").where("id", template.id).first();

        if (existingTemplate) {
          await DB.from("template")
            .where("id", template.id)
            .update({
              name: template.name,
              content: template.content,
              category: template.category,
              is_custom: template.isCustom !== undefined ? template.isCustom : true,
              updated_at: now,
            });
        } else {
          await DB.from("template").insert({
            id: template.id,
            name: template.name,
            content: template.content,
            category: template.category,
            is_custom: template.isCustom !== undefined ? template.isCustom : true,
            created_at: now,
            updated_at: now,
          });
        }

        return {
          ...template,
          createdAt: now,
          updatedAt: now,
        };
      } catch (err) {
        log.error("保存模板失败", err);
        return null;
      }
    }
  );

  ipcMain.handle("delete-template", async (event: IpcMainInvokeEvent, id: string) => {
    try {
      await DB.from("template").where("id", id).delete();
      return true;
    } catch (err) {
      log.error("删除模板失败", err);
      return false;
    }
  });


  ipcMain.handle("get-ai-skills", async () => {
    try {
      const rows = await DB.from("template")
        .select("*")
        .where("category", SKILL_CATEGORY)
        .orderBy("created_at", "asc");

      return rows.map((t: any) => ({
        id: t.id,
        name: t.name,
        content: t.content,
        category: t.category,
        isCustom: !!t.is_custom,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
    } catch (err) {
      log.error("获取AI技能失败", err);
      return [];
    }
  });

  ipcMain.handle(
    "save-ai-skill",
    async (
      _event: IpcMainInvokeEvent,
      skill: { id?: string; name: string; content: string }
    ) => {
      const trimmedName = (skill.name || "").trim();
      const trimmedContent = (skill.content || "").trim();

      const validation = validateSkill({
        name: trimmedName,
        content: trimmedContent,
      });
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const now = new Date();
        const isUpdate = !!skill.id;

        if (isUpdate) {
          const existing = await DB.from("template")
            .where("id", skill.id)
            .where("category", SKILL_CATEGORY)
            .first();
          if (!existing) {
            return { success: false, error: "技能不存在" };
          }
          await DB.from("template").where("id", skill.id).update({
            name: trimmedName,
            content: trimmedContent,
            updated_at: now,
          });
          return { success: true, id: skill.id };
        }

        const duplicate = await DB.from("template")
          .where("category", SKILL_CATEGORY)
          .where("name", trimmedName)
          .first();
        if (duplicate) {
          return { success: false, error: `已存在同名技能「${trimmedName}」` };
        }

        const id = randomUUID();
        await DB.from("template").insert({
          id,
          name: trimmedName,
          content: trimmedContent,
          category: SKILL_CATEGORY,
          is_custom: true,
          created_at: now,
          updated_at: now,
        });
        return { success: true, id };
      } catch (err) {
        log.error("保存AI技能失败", err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  ipcMain.handle("delete-ai-skill", async (_event: IpcMainInvokeEvent, id: string) => {
    try {
      const deleted = await DB.from("template")
        .where("id", id)
        .where("category", SKILL_CATEGORY)
        .delete();
      return { success: deleted > 0, deleted };
    } catch (err) {
      log.error("删除AI技能失败", err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    "preview-ai-skill-url",
    async (_event: IpcMainInvokeEvent, url: string) => {
      log.info(`[skill] 预览远程 skill: ${url}`);
      return fetchSkillPreview(url);
    }
  );

  ipcMain.handle(
    "import-ai-skills",
    async (
      _event: IpcMainInvokeEvent,
      skills: Array<{ name: string; content: string }>
    ) => {
      const imported: string[] = [];
      const updated: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];

      try {
        for (const s of skills || []) {
          const name = (s?.name || "").trim();
          const content = (s?.content || "").trim();

          const validation = validateSkill({ name, content });
          if (!validation.valid) {
            skipped.push({ name: name || '(无名称)', reason: validation.error || '校验失败' });
            continue;
          }

          const now = new Date();
          const existing = await DB.from("template")
            .where("category", SKILL_CATEGORY)
            .where("name", name)
            .first();

          if (existing) {
            await DB.from("template").where("id", existing.id).update({
              content,
              updated_at: now,
            });
            updated.push(name);
          } else {
            await DB.from("template").insert({
              id: randomUUID(),
              name,
              content,
              category: SKILL_CATEGORY,
              is_custom: true,
              created_at: now,
              updated_at: now,
            });
            imported.push(name);
          }
        }

        log.info(
          `[skill] 导入完成: 新增 ${imported.length}，更新 ${updated.length}，跳过 ${skipped.length}`
        );
        return { success: true, imported, updated, skipped };
      } catch (err) {
        log.error("[skill] 导入失败:", err);
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          imported,
          updated,
          skipped,
        };
      }
    }
  );
}

