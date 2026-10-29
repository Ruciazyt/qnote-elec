import { ipcMain, IpcMainInvokeEvent } from "electron";
import { vectorStore } from "../utils/vectorStore";
import { log } from "../utils/log";

export function registerVectorHandlers(DB: any) {
  const handleAddToMemory = async (_event: IpcMainInvokeEvent, noteId: number) => {
    try {
      const note = await DB.from("note").select("*").where("id", noteId).first();
      if (!note) {
        return { success: false, error: "笔记不存在" };
      }

      // 检查是否已经索引过
      if (note.vector_indexed === 1) {
        return { success: false, error: "该笔记已经添加到记忆索引" };
      }

      const result = await vectorStore.addNote(
        noteId,
        note.content,
        note.type || "text",
        note.ocr_result
      );

      if (result.success) {
        // 更新笔记的索引状态和向量ID
        await DB.from("note")
          .where("id", noteId)
          .update({
            vector_indexed: 1,
            vector_id: result.vectorId || ''
          });
        log.info(`笔记 ${noteId} 已添加到记忆索引`);
      } else {
        log.error(`添加笔记 ${noteId} 到记忆索引失败:`, result.error);
      }

      return result;
    } catch (error) {
      log.error("添加笔记到记忆索引失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleRemoveFromMemory = async (_event: IpcMainInvokeEvent, noteId: number) => {
    try {
      const note = await DB.from("note").select("*").where("id", noteId).first();
      if (!note) {
        return { success: false, error: "笔记不存在" };
      }

      // 检查是否已经索引过
      if (note.vector_indexed !== 1) {
        return { success: false, error: "该笔记未添加到记忆索引" };
      }

      // 如果有vector_id，直接使用它删除
      if (note.vector_id) {
        const result = await vectorStore.deleteNote(note.vector_id);

        if (result.success) {
          // 更新笔记的索引状态
          await DB.from("note")
            .where("id", noteId)
            .update({
              vector_indexed: 0,
              vector_id: ''
            });
          log.info(`笔记 ${noteId} 已从记忆索引删除`);
        } else {
          log.error(`从记忆索引删除笔记 ${noteId} 失败:`, result.error);
        }

        return result;
      } else {
        // 如果没有vector_id，通过搜索来找到对应的向量
        const searchResult = await vectorStore.searchSimilar(note.content, 1);
        if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
          const vectorId = searchResult.results[0].id;
          const result = await vectorStore.deleteNote(vectorId);

          if (result.success) {
            // 更新笔记的索引状态
            await DB.from("note")
              .where("id", noteId)
              .update({
                vector_indexed: 0,
                vector_id: ''
              });
            log.info(`笔记 ${noteId} 已从记忆索引删除`);
          } else {
            log.error(`从记忆索引删除笔记 ${noteId} 失败:`, result.error);
          }

          return result;
        } else {
          return { success: false, error: "未找到对应的向量" };
        }
      }
    } catch (error) {
      log.error("从记忆索引删除笔记失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleMemorySearch = async (_event: IpcMainInvokeEvent, query: string, topK: number = 5) => {
    try {
      const result = await vectorStore.searchSimilar(query, topK);

      if (result.success && result.results) {
        log.info(`记忆检索找到 ${result.results.length} 个结果`);
        return {
          success: true,
          results: result.results.map(r => ({
            id: r.noteId,
            content: r.content,
            type: r.type,
            ocr_result: r.ocr_result,
            distance: r.distance
          }))
        };
      } else {
        return { success: false, error: result.error || "搜索失败" };
      }
    } catch (error) {
      log.error("记忆检索失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleBatchIndexMemory = async () => {
    try {
      // 只获取未索引的笔记
      const notes = await DB.from("note")
        .select("*")
        .where("vector_indexed", "!=", 1)
        .orWhereNull("vector_indexed")
        .orderBy("created_at", "desc");

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const note of notes) {
        try {
          const result = await vectorStore.addNote(
            note.id,
            note.content,
            note.type || "text",
            note.ocr_result
          );

          if (result.success) {
            // 更新笔记的索引状态和向量ID
            await DB.from("note")
              .where("id", note.id)
              .update({
                vector_indexed: 1,
                vector_id: result.vectorId || ''
              });
            successCount++;
          } else {
            errorCount++;
            errors.push(`笔记 ${note.id}: ${result.error}`);
          }
        } catch (error) {
          errorCount++;
          errors.push(`笔记 ${note.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      log.info(`批量记忆索引完成: 成功 ${successCount} 个, 失败 ${errorCount} 个`);

      return {
        success: true,
        successCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      log.error("批量记忆索引失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleGetMemoryCount = async () => {
    try {
      const result = await vectorStore.getCount();
      return result;
    } catch (error) {
      log.error("获取记忆索引数量失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleClearMemoryStore = async () => {
    try {
      const result = await vectorStore.clearAll();

      if (result.success) {
        await DB.from("note").update({
          vector_indexed: 0,
          vector_id: ""
        });
        log.info("记忆索引已清空");
      } else {
        log.error("清空记忆索引失败:", result.error);
      }

      return result;
    } catch (error) {
      log.error("清空记忆索引失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleGetMemoryStoreConfig = async () => {
    return {
      chromaServerUrl: "local-memory",
      embeddingServiceUrl: "local-memory"
    };
  };

  const handleSetMemoryStoreConfig = async (_event: IpcMainInvokeEvent, chromaServerUrl: string, embeddingServiceUrl: string) => {
    try {
      log.info("记忆模式下忽略远程向量配置", { chromaServerUrl, embeddingServiceUrl });
      const result = await vectorStore.updateConfig(chromaServerUrl, embeddingServiceUrl);

      return result;
    } catch (error) {
      log.error("设置记忆索引配置失败", error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  ipcMain.handle("add-to-memory", handleAddToMemory);
  ipcMain.handle("add-to-vector", handleAddToMemory);
  ipcMain.handle("remove-from-memory", handleRemoveFromMemory);
  ipcMain.handle("remove-from-vector", handleRemoveFromMemory);
  ipcMain.handle("memory-search", handleMemorySearch);
  ipcMain.handle("vector-search", handleMemorySearch);
  ipcMain.handle("batch-index-memory", handleBatchIndexMemory);
  ipcMain.handle("batch-index-notes", handleBatchIndexMemory);
  ipcMain.handle("get-memory-count", handleGetMemoryCount);
  ipcMain.handle("get-vector-count", handleGetMemoryCount);
  ipcMain.handle("clear-memory-store", handleClearMemoryStore);
  ipcMain.handle("clear-vector-store", handleClearMemoryStore);
  ipcMain.handle("get-memory-store-config", handleGetMemoryStoreConfig);
  ipcMain.handle("get-vector-store-config", handleGetMemoryStoreConfig);
  ipcMain.handle("set-memory-store-config", handleSetMemoryStoreConfig);
  ipcMain.handle("set-vector-store-config", handleSetMemoryStoreConfig);
}

