import { createPlugin } from "../../../resources/plugin-sdk/qnote-plugin-sdk";

export default createPlugin({
  async activate(ctx) {
    ctx.log.info("hello-qnote 正在激活");
    await ctx.notifications.info("Hello QNote 示例插件已激活");

    ctx.commands.register("hello.sayHi", async () => {
      const setting = await ctx.settings.get("greeting");
      const greeting = setting?.value ?? "你好，QNote";
      await ctx.notifications.info(String(greeting));

      try {
        const todos = await ctx.todos.list({ limit: 3 });
        ctx.log.info(`当前有 ${todos.count} 条待办`);
      } catch (err) {
        ctx.log.warn(`读待办被拒：${err && err.message ? err.message : err}`);
      }
    });
  },

  async deactivate() {
    console.log("hello-qnote 已停用");
  },
});
