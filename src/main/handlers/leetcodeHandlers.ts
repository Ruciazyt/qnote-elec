import { ipcMain, IpcMainInvokeEvent } from "electron";
import { log } from "../utils/log";
import { configManager } from "../utils/config";
import { aiService, AiMessage } from "../utils/aiService";
import fetch from "node-fetch";

// LeetCode API 配置
const LEETCODE_CONFIG = {
  CN: {
    graphqlUrl: "https://leetcode.cn/graphql/",
    baseUrl: "https://leetcode.cn",
  },
  US: {
    graphqlUrl: "https://leetcode.com/graphql/",
    baseUrl: "https://leetcode.com",
  },
};

// 默认使用中文站
const DEFAULT_IS_CN = true;

// 统一的 GraphQL 请求函数
async function graphqlRequest(
  query: string,
  variables: Record<string, any>,
  isCN: boolean = DEFAULT_IS_CN
): Promise<any> {
  const config = isCN ? LEETCODE_CONFIG.CN : LEETCODE_CONFIG.US;
  const graphqlUrl = config.graphqlUrl;

  // 标准的浏览器请求头
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": isCN ? "zh-CN,zh;q=0.9,en;q=0.8" : "en-US,en;q=0.9",
    "Origin": config.baseUrl,
    "Referer": `${config.baseUrl}/problemset/all/`,
  };

  const requestBody = {
    query,
    variables,
  };

  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    timeout: 10000, // 10秒超时
  } as any);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GraphQL错误: ${JSON.stringify(data.errors)}`);
  }

  return data.data;
}

// 通过 titleSlug 直接查询题目（最精确的方法）
async function getProblemBySlug(titleSlug: string, isCN: boolean = DEFAULT_IS_CN): Promise<any> {
  const query = `
    query questionTitle($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        titleSlug
        translatedTitle
        difficulty
      }
    }
  `;

  try {
    const data = await graphqlRequest(query, { titleSlug }, isCN);
    if (data?.question) {
      return {
        success: true,
        question: data.question,
      };
    }
    return { success: false, error: "题目不存在" };
  } catch (err: any) {
    return { success: false, error: err?.message || "查询失败" };
  }
}

// 搜索题目的辅助函数
async function searchLeetcodeProblem(title: string, number?: string): Promise<any> {
  const isCN = DEFAULT_IS_CN;

  // 如果有题目编号，优先通过编号查询
  if (number) {
    try {
      log.info(`尝试通过编号查询题目：${number}`);
      const query = `
        query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
          problemsetQuestionList(
            categorySlug: $categorySlug
            limit: $limit
            skip: $skip
            filters: $filters
          ) {
            total
            questions {
              titleSlug
              title
            }
          }
        }
      `;

      const data = await graphqlRequest(
        query,
        {
          categorySlug: null,
          limit: 10, // 增加返回数量，提高匹配准确度
          skip: 0,
          filters: {
            searchKeywords: number,
          },
        },
        isCN
      );

      if (data?.problemsetQuestionList?.questions?.length > 0) {
        const questions = data.problemsetQuestionList.questions;
        // 使用第一个结果（通过编号搜索通常第一个就是最匹配的）
        const matchedQuestion = questions[0];

        const slug = matchedQuestion.titleSlug;
        const url = isCN
          ? `${LEETCODE_CONFIG.CN.baseUrl}/problems/${slug}/description/`
          : `${LEETCODE_CONFIG.US.baseUrl}/problems/${slug}/description/`;

        // 通过 titleSlug 获取完整信息（包括 translatedTitle 和 difficulty）
        const fullInfo = await getProblemBySlug(slug, isCN);
        const finalTitle = fullInfo.success && fullInfo.question
          ? (isCN && fullInfo.question.translatedTitle ? fullInfo.question.translatedTitle : fullInfo.question.title)
          : matchedQuestion.title;
        const difficulty = fullInfo.success && fullInfo.question
          ? fullInfo.question.difficulty || ""
          : "";

        log.info(`通过编号找到题目：${number} -> ${url}`);
        return {
          success: true,
          url,
          title: finalTitle,
          slug,
          difficulty,
        };
      } else {
        log.warn(`通过编号查询未找到题目：${number}`);
      }
    } catch (err: any) {
      log.warn(`通过编号查询题目失败（${number}），尝试其他方式`, { error: err?.message });
    }
  }

  // 尝试通过题目标题搜索
  if (title) {
    try {
      log.info(`尝试通过标题搜索题目：${title}`);
      const query = `
        query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
          problemsetQuestionList(
            categorySlug: $categorySlug
            limit: $limit
            skip: $skip
            filters: $filters
          ) {
            total
            questions {
              titleSlug
              title
            }
          }
        }
      `;

      const data = await graphqlRequest(
        query,
        {
          categorySlug: null,
          limit: 10, // 增加返回数量，提高匹配准确度
          skip: 0,
          filters: {
            searchKeywords: title,
          },
        },
        isCN
      );

      if (data?.problemsetQuestionList?.questions?.length > 0) {
        // 找到最匹配的题目（优先完全匹配标题）
        const questions = data.problemsetQuestionList.questions;
        let matchedQuestion = questions.find(
          (q: any) =>
            q.title === title ||
            q.title.toLowerCase() === title.toLowerCase()
        );

        // 如果没有完全匹配，使用第一个结果
        if (!matchedQuestion) {
          matchedQuestion = questions[0];
        }

        const slug = matchedQuestion.titleSlug;
        const url = isCN
          ? `${LEETCODE_CONFIG.CN.baseUrl}/problems/${slug}/description/`
          : `${LEETCODE_CONFIG.US.baseUrl}/problems/${slug}/description/`;

        // 通过 titleSlug 获取完整信息（包括 translatedTitle 和 difficulty）
        const fullInfo = await getProblemBySlug(slug, isCN);
        const finalTitle = fullInfo.success && fullInfo.question
          ? (isCN && fullInfo.question.translatedTitle ? fullInfo.question.translatedTitle : fullInfo.question.title)
          : matchedQuestion.title;
        const difficulty = fullInfo.success && fullInfo.question
          ? fullInfo.question.difficulty || ""
          : "";

        log.info(`通过标题找到题目：${title} -> ${url}`);
        return {
          success: true,
          url,
          title: finalTitle,
          slug,
          difficulty,
        };
      } else {
        log.warn(`通过标题查询未找到题目：${title}`);
      }
    } catch (err: any) {
      log.warn(`通过标题搜索题目失败（${title}）`, { error: err?.message });
    }
  }


  // 如果所有GraphQL查询都失败，返回错误
  // 注意：LeetCode的URL必须使用英文slug（titleSlug），不能从中文标题构造
  const searchTitle = title || number || "";
  if (!searchTitle) {
    log.error("题目名称和编号都为空");
    return {
      success: false,
      error: "题目名称和编号都为空"
    };
  }

  log.error(`所有GraphQL查询失败，无法获取题目的英文slug（titleSlug）`);
  return {
    success: false,
    error: `无法通过GraphQL API找到题目"${searchTitle}"，请检查题目名称或编号是否正确。LeetCode的URL需要使用英文slug，无法从中文标题构造。`
  };
}

export function registerLeetcodeHandlers(DB: any) {
  ipcMain.handle("get-leetcode-collections", async () => {
    try {
      const collections = await DB.from("leetcode_collection")
        .select("*")
        .orderBy("updated_at", "desc");
      return collections;
    } catch (err) {
      log.error("获取题单列表失败", err);
      return [];
    }
  });

  ipcMain.handle("get-leetcode-collection", async (event: IpcMainInvokeEvent, id: number) => {
    try {
      const collection = await DB.from("leetcode_collection")
        .select("*")
        .where("id", id)
        .first();

      if (!collection) {
        return null;
      }

      // 获取关联的题目
      const problems = await DB.from("leetcode_problem")
        .select("*")
        .where("collection_id", id)
        .orderBy("created_at", "asc");

      return {
        ...collection,
        problems
      };
    } catch (err) {
      log.error("获取题单失败", err);
      return null;
    }
  });

  ipcMain.handle(
    "save-leetcode-collection",
    async (
      event: IpcMainInvokeEvent,
      collection: { id?: number; name: string; summary: string; problems?: Array<{ id?: number; link: string; is_completed: boolean; title?: string; difficulty?: string }> }
    ) => {
      try {
        const now = new Date();

        if (collection.id) {
          // 更新现有题单
          await DB.from("leetcode_collection")
            .where("id", collection.id)
            .update({
              name: collection.name,
              summary: collection.summary,
              updated_at: now,
            });

          // 如果提供了题目列表，更新题目
          if (collection.problems) {
            // 获取现有题目ID
            const existingProblems = await DB.from("leetcode_problem")
              .select("id")
              .where("collection_id", collection.id);
            const existingIds = existingProblems.map((p: any) => p.id);

            // 更新或插入题目
            for (const problem of collection.problems) {
              if (problem.id && existingIds.includes(problem.id)) {
                // 更新现有题目
                await DB.from("leetcode_problem")
                  .where("id", problem.id)
                  .update({
                    link: problem.link,
                    title: problem.title || "",
                    difficulty: problem.difficulty || "",
                    is_completed: problem.is_completed,
                    updated_at: now,
                  });
              } else {
                // 插入新题目
                await DB.from("leetcode_problem").insert({
                  collection_id: collection.id,
                  link: problem.link,
                  title: problem.title || "",
                  difficulty: problem.difficulty || "",
                  is_completed: problem.is_completed,
                  created_at: now,
                  updated_at: now,
                });
              }
            }

            // 删除不在新列表中的题目
            const newIds = collection.problems
              .filter((p) => p.id)
              .map((p) => p.id) as number[];
            const toDelete = existingIds.filter((id: number) => !newIds.includes(id));
            if (toDelete.length > 0) {
              await DB.from("leetcode_problem")
                .whereIn("id", toDelete)
                .delete();
            }
          }

          // 重新获取完整数据
          const updated = await DB.from("leetcode_collection")
            .select("*")
            .where("id", collection.id)
            .first();
          const problems = await DB.from("leetcode_problem")
            .select("*")
            .where("collection_id", collection.id)
            .orderBy("created_at", "asc");

          return {
            ...updated,
            problems,
          };
        } else {
          // 新建题单
          const [id] = await DB.from("leetcode_collection").insert({
            name: collection.name,
            summary: collection.summary,
            created_at: now,
            updated_at: now,
          });

          // 插入题目
          if (collection.problems && collection.problems.length > 0) {
            await DB.from("leetcode_problem").insert(
              collection.problems.map((problem) => ({
                collection_id: id,
                link: problem.link,
                title: problem.title || "",
                difficulty: problem.difficulty || "",
                is_completed: problem.is_completed,
                created_at: now,
                updated_at: now,
              }))
            );
          }

          // 返回完整数据
          const newCollection = await DB.from("leetcode_collection")
            .select("*")
            .where("id", id)
            .first();
          const problems = await DB.from("leetcode_problem")
            .select("*")
            .where("collection_id", id)
            .orderBy("created_at", "asc");

          return {
            ...newCollection,
            problems,
          };
        }
      } catch (err) {
        log.error("保存题单失败", err);
        return null;
      }
    }
  );

  ipcMain.handle("delete-leetcode-collection", async (event: IpcMainInvokeEvent, id: number) => {
    try {
      // 删除题单会自动删除关联的题目（CASCADE）
      await DB.from("leetcode_collection").where("id", id).delete();
      return true;
    } catch (err) {
      log.error("删除题单失败", err);
      return false;
    }
  });

  ipcMain.handle(
    "update-leetcode-problem",
    async (
      event: IpcMainInvokeEvent,
      problemId: number,
      updates: { link?: string; is_completed?: boolean; difficulty?: string }
    ) => {
      try {
        await DB.from("leetcode_problem")
          .where("id", problemId)
          .update({
            ...updates,
            updated_at: new Date(),
          });
        return true;
      } catch (err) {
        log.error("更新题目失败", err);
        return false;
      }
    }
  );

  // 通过题目名称或编号搜索并获取题目URL
  ipcMain.handle("search-leetcode-problem-by-title", async (event: IpcMainInvokeEvent, title: string, number?: string) => {
    try {
      return await searchLeetcodeProblem(title, number);
    } catch (err) {
      log.error("搜索 LeetCode 题目失败", err);
      return { success: false, error: err.message || "搜索题目失败" };
    }
  });

  // 通过 GraphQL 获取 LeetCode 题目标题
  ipcMain.handle("get-leetcode-problem-title", async (event: IpcMainInvokeEvent, url: string) => {
    try {
      // 从 URL 中提取 slug
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\/problems\/([^/]+)\/?/);
      if (!match || !match[1]) {
        return { success: false, error: "无法从 URL 中提取题目 slug" };
      }

      const slug = match[1];
      const isCN = urlObj.hostname.includes("leetcode.cn");

      // 使用统一的 GraphQL 请求函数
      const result = await getProblemBySlug(slug, isCN);

      if (!result.success || !result.question) {
        return { success: false, error: result.error || "题目不存在" };
      }

      const question = result.question;

      // 优先使用翻译标题（中文站），否则使用英文标题
      const title = isCN && question.translatedTitle
        ? question.translatedTitle
        : question.title;

      return {
        success: true,
        title: title || slug,
        questionId: question.questionId,
        frontendId: question.questionFrontendId,
        difficulty: question.difficulty || "",
      };
    } catch (err: any) {
      log.error("获取 LeetCode 题目标题失败", err);
      return { success: false, error: err?.message || "获取题目标题失败" };
    }
  });

  // 解析文本为题单结构
  async function parseCollectionsFromText(
    text: string,
    event: IpcMainInvokeEvent
  ): Promise<{ success: boolean; collections?: any[]; error?: string }> {
    try {
      const aiConfig = await configManager.getAiConfig();

      if (!aiConfig.apiKey) {
        return { success: false, error: "请先在设置中配置AI API Key" };
      }

      // 发送解析阶段进度
      event.sender.send("import-progress", {
        stage: "parsing",
        progress: 0,
        total: 100,
        current: "正在解析输入文本..."
      });

      // 构建AI提示词，支持单个或批量题单
      const systemPrompt = `你是一个LeetCode题单解析助手。用户会输入一段文本，可能包含一个或多个题单的名称和题目列表。
请仔细分析文本，提取以下信息：
1. 题单名称（如果存在，可能在开头或标题位置）
2. 题目列表（可能是题目名称、编号、URL等）

如果输入包含多个题单（通过明显的分隔符、标题等区分），请返回多个题单；如果只有一个题单，也使用相同的格式。

请严格按照以下JSON格式返回结果，不要添加任何其他文字：
{
  "collections": [
    {
      "collectionName": "题单名称（如果不存在则返回空字符串）",
      "problems": [
        {"title": "题目名称", "number": "题目编号（如果有，如'1'、'2'等，可选）"},
        ...
      ]
    },
    ...
  ]
}

注意：
- 如果输入只有一个题单，collections数组只包含一个元素
- 如果题目是URL格式，提取其中的题目名称或编号
- 如果题目只有编号（如"1"、"2"），title可以是空字符串，但number必须填写
- 如果题目只有名称（如"两数之和"），title填写名称，number可以为空
- 如果题目既有编号又有名称（如"1. 两数之和"），两者都要填写
- 返回的JSON必须是有效的，可以直接解析`;

      const userPrompt = `请解析以下文本，提取题单名称和题目列表（可能包含多个题单）：\n\n${text}`;

      // 调用AI服务
      const messages: AiMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const response = await aiService.sendMessage(messages, {
        provider: aiConfig.provider as any,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        baseUrl: aiConfig.baseUrl
      });

      // 解析AI返回的JSON
      let parsedResult: any;
      try {
        // 尝试提取JSON（可能AI返回了markdown代码块）
        let jsonText = response.content.trim();
        // 围栏内的空白由 trim 去掉；正则不写 \s* 包裹，避免多处无界量词相邻
        // 造成 O(n²) 回溯（SonarCloud S8786）
        const jsonMatch = jsonText.match(/```(?:json)?([\s\S]*?)```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1].trim();
        }
        // 移除可能的markdown标记
        jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^((?:[\s\S]*[^\s])?)\s*```$/i, "$1");
        parsedResult = JSON.parse(jsonText);
      } catch (parseError) {
        log.error("AI返回的JSON解析失败", { content: response.content, error: parseError });
        return { success: false, error: "AI解析失败：返回的格式不正确，请确保输入包含有效的题目信息" };
      }

      // 验证解析结果 - 支持新的批量格式和旧的单题单格式
      let collections: any[] = [];
      if (parsedResult.collections && Array.isArray(parsedResult.collections)) {
        // 新格式：批量题单
        collections = parsedResult.collections;
      } else if (parsedResult.problems && Array.isArray(parsedResult.problems)) {
        // 旧格式：单个题单（向后兼容）
        collections = [{
          collectionName: parsedResult.collectionName || "",
          problems: parsedResult.problems
        }];
      } else {
        return { success: false, error: "AI解析失败：未找到题单或题目列表" };
      }

      if (collections.length === 0) {
        return { success: false, error: "未找到任何题单，请检查输入内容" };
      }

      // 发送解析完成进度
      event.sender.send("import-progress", {
        stage: "parsing",
        progress: 100,
        total: 100,
        current: `解析完成，找到 ${collections.length} 个题单`
      });

      return { success: true, collections };
    } catch (error: any) {
      log.error("解析题单失败", error);
      return { success: false, error: error?.message || "解析题单时出错" };
    }
  }

  // 发送获取URL阶段的进度
  function sendFetchingProgress(
    processedSteps: number,
    totalSteps: number,
    fetchingProgressMax: number,
    event: IpcMainInvokeEvent,
    current: string
  ): void {
    const fetchingProgress = totalSteps > 0
      ? Math.min(Math.floor((processedSteps / totalSteps) * fetchingProgressMax), fetchingProgressMax)
      : 0;
    event.sender.send("import-progress", {
      stage: "fetching",
      progress: fetchingProgress,
      total: 100,
      current
    });
  }

  // 获取题目URL列表
  async function fetchProblemUrls(
    problems: any[],
    collectionName: string,
    totalSteps: number,
    processedSteps: { value: number },
    fetchingProgressMax: number,
    event: IpcMainInvokeEvent
  ): Promise<{ problemResults: Array<{ link: string; title: string; difficulty: string; is_completed: boolean }>; errors: string[] }> {
    const problemResults: Array<{ link: string; title: string; difficulty: string; is_completed: boolean }> = [];
    const errors: string[] = [];

    for (let i = 0; i < problems.length; i++) {
      const problem = problems[i];
      const title = problem.title?.trim() || "";
      const number = problem.number?.trim() || "";

      if (!title && !number) {
        errors.push(`第 ${i + 1} 个题目：缺少题目名称和编号`);
        processedSteps.value++;
        sendFetchingProgress(processedSteps.value, totalSteps, fetchingProgressMax, event, `跳过题目 ${i + 1}/${problems.length}：缺少信息`);
        continue;
      }

      // 发送当前题目进度（在处理前）
      sendFetchingProgress(processedSteps.value, totalSteps, fetchingProgressMax, event, `正在获取题目 ${i + 1}/${problems.length}：${title || number}`);

      try {
        // 如果输入已经是URL，直接使用
        if (title.startsWith("http://") || title.startsWith("https://")) {
          problemResults.push({
            link: title,
            title: title,
            difficulty: "",
            is_completed: false
          });
          processedSteps.value++;
          sendFetchingProgress(processedSteps.value, totalSteps, fetchingProgressMax, event, `已获取题目 ${i + 1}/${problems.length}：${title}`);
          continue;
        }

        // 调用搜索函数获取URL
        const searchResult = await searchLeetcodeProblem(title, number || undefined);

        if (!searchResult || !searchResult.success) {
          errors.push(`第 ${i + 1} 个题目"${title || number}"：无法获取题目链接 - ${searchResult?.error || "未知错误"}`);
          processedSteps.value++;
          sendFetchingProgress(processedSteps.value, totalSteps, fetchingProgressMax, event, `获取失败：${title || number}`);
          continue;
        }

        problemResults.push({
          link: searchResult.url,
          title: searchResult.title || title || number,
          difficulty: searchResult.difficulty || "",
          is_completed: false
        });
        processedSteps.value++;

        sendFetchingProgress(processedSteps.value, totalSteps, fetchingProgressMax, event, `已获取题目 ${i + 1}/${problems.length}：${searchResult.title || title || number}`);

        // 添加延迟避免速率限制
        if (i < problems.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        log.error(`处理题目失败：${title || number}`, error);
        errors.push(`第 ${i + 1} 个题目"${title || number}"：处理失败 - ${error?.message || "未知错误"}`);
        processedSteps.value++;
        sendFetchingProgress(processedSteps.value, totalSteps, fetchingProgressMax, event, `处理失败：${title || number}`);
      }
    }

    return { problemResults, errors };
  }

  // 创建题单和题目到数据库
  async function createCollectionWithProblems(
    collectionName: string,
    problemResults: Array<{ link: string; title: string; difficulty: string; is_completed: boolean }>,
    DB: any,
    errors?: string[]
  ): Promise<{ success: boolean; collection?: any; error?: string }> {
    try {
      const now = new Date();
      const successCount = problemResults.length;
      const failCount = errors?.length || 0;

      // 构建summary信息
      let summary = `通过AI导入，包含 ${successCount} 道题目`;
      if (failCount > 0) {
        summary += `，${failCount} 道题目解析失败`;
      }

      log.info(`准备创建题单：${collectionName}，包含 ${successCount} 道题目${failCount > 0 ? `，${failCount} 道失败` : ''}`);

      const insertResult = await DB.from("leetcode_collection").insert({
        name: collectionName,
        summary,
        created_at: now,
        updated_at: now,
      });

      // 获取插入的ID（SQLite返回数组，其他数据库可能不同）
      const collectionId = Array.isArray(insertResult) ? insertResult[0] : insertResult;

      if (!collectionId) {
        throw new Error("无法获取题单ID，插入可能失败");
      }

      log.info(`题单创建成功，ID：${collectionId}`);

      // 插入题目
      if (problemResults.length > 0) {
        log.info(`准备插入 ${problemResults.length} 道题目到题单 ${collectionId}`);
        await DB.from("leetcode_problem").insert(
          problemResults.map((problem) => ({
            collection_id: collectionId,
            link: problem.link,
            title: problem.title || "",
            difficulty: problem.difficulty || "",
            is_completed: problem.is_completed || false,
            created_at: now,
            updated_at: now,
          }))
        );
        log.info(`题目插入成功`);
      }

      // 返回完整数据
      const collection = await DB.from("leetcode_collection")
        .select("*")
        .where("id", collectionId)
        .first();

      if (!collection) {
        throw new Error("无法查询到刚创建的题单");
      }

      const collectionProblems = await DB.from("leetcode_problem")
        .select("*")
        .where("collection_id", collectionId)
        .orderBy("created_at", "asc");

      log.info(`题单导入成功：${collectionName}，包含 ${collectionProblems.length} 道题目`);

      return {
        success: true,
        collection: {
          ...collection,
          problems: collectionProblems
        }
      };
    } catch (dbError: any) {
      log.error(`创建题单失败：${collectionName}`, {
        error: dbError,
        message: dbError?.message,
        stack: dbError?.stack,
        problemCount: problemResults.length
      });
      return {
        success: false,
        error: `题单"${collectionName}"：创建失败 - ${dbError?.message || "数据库错误"}`
      };
    }
  }

  // 导入题单处理程序（支持批量导入）
  ipcMain.handle("import-leetcode-collection", async (event: IpcMainInvokeEvent, text: string) => {
    try {
      // 解析文本为题单结构
      const parseResult = await parseCollectionsFromText(text, event);
      if (!parseResult.success || !parseResult.collections) {
        return { success: false, error: parseResult.error || "解析失败" };
      }

      const collections = parseResult.collections;

      // 处理每个题单
      const results: Array<{ success: boolean; collection?: any; error?: string }> = [];
      const totalSteps = collections.reduce((sum, c) => sum + (c.problems?.length || 0), 0);
      const processedSteps = { value: 0 };
      // 进度分配：获取URL占70%，创建题单占30%
      const fetchingProgressMax = 70;
      const creatingProgressMax = 30;

      for (let colIdx = 0; colIdx < collections.length; colIdx++) {
        const collectionData = collections[colIdx];
        const collectionName = collectionData.collectionName?.trim() || `导入题单-${colIdx + 1}-${new Date().toLocaleDateString()}`;
        const parsedProblems = collectionData.problems || [];

        if (parsedProblems.length === 0) {
          results.push({
            success: false,
            error: `题单"${collectionName}"：未找到任何题目`
          });
          continue;
        }

        log.info(`开始导入题单 ${colIdx + 1}/${collections.length}：${collectionName}，包含 ${parsedProblems.length} 道题目`);

        // 发送获取URL阶段进度（题单开始）
        sendFetchingProgress(
          processedSteps.value,
          totalSteps,
          fetchingProgressMax,
          event,
          `正在获取题单"${collectionName}"的题目链接... (${colIdx + 1}/${collections.length})`
        );

        // 为每个题目获取URL
        const { problemResults, errors } = await fetchProblemUrls(
          parsedProblems,
          collectionName,
          totalSteps,
          processedSteps,
          fetchingProgressMax,
          event
        );

        // 记录错误信息，但不阻止创建题单
        const errorMessages: string[] = [];
        if (errors.length > 0) {
          log.warn(`题单"${collectionName}"处理完成，但有错误：`, errors);
          errorMessages.push(...errors);
        }

        // 即使有错误或没有成功题目，也尝试创建题单（可能创建空题单）
        // 发送创建题单阶段进度
        const creatingProgress = fetchingProgressMax + Math.floor(((colIdx + 1) / collections.length) * creatingProgressMax);
        event.sender.send("import-progress", {
          stage: "creating",
          progress: Math.min(creatingProgress, 100),
          total: 100,
          current: `正在创建题单"${collectionName}"... (${colIdx + 1}/${collections.length})`
        });

        // 创建题单（即使problemResults为空也创建）
        const createResult = await createCollectionWithProblems(
          collectionName,
          problemResults,
          DB,
          errorMessages.length > 0 ? errorMessages : undefined
        );

        // 如果有错误信息，添加到结果中
        if (errorMessages.length > 0 && createResult.success) {
          createResult.error = `以下题目无法处理：\n${errorMessages.join('\n')}`;
        }

        results.push(createResult);
      }

      // 发送完成进度
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      event.sender.send("import-progress", {
        stage: "creating",
        progress: 100,
        total: 100,
        current: `导入完成：成功 ${successCount} 个，失败 ${failCount} 个`
      });

      const successCollections = results.filter(r => r.success).map(r => r.collection);
      const errors = results.filter(r => !r.success).map(r => r.error).join('\n\n');

      return {
        success: successCount > 0,
        collections: successCollections,
        successCount,
        failCount,
        errors: errors || undefined,
        message: `成功导入 ${successCount} 个题单${failCount > 0 ? `，失败 ${failCount} 个` : ''}`
      };
    } catch (error: any) {
      log.error("导入题单失败", error);
      // 发送错误进度
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send("import-progress", {
          stage: "creating",
          progress: 0,
          total: 100,
          current: `导入失败：${error?.message || "未知错误"}`
        });
      }
      return { success: false, error: error?.message || "导入题单时出错" };
    }
  });
}

