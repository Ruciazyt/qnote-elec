const s = require("sqlite3");
const d = new s.Database("dist/database/clipboard.sqlite", s.OPEN_READONLY);

d.get("SELECT COUNT(*) AS n FROM ai_chat", (e, r) => {
  if (e) throw e;
  console.log("ai_chat 总行数:", r.n);
  d.get("SELECT COUNT(*) AS n FROM ai_chat_summary", (e2, r2) => {
    if (e2) throw e2;
    console.log("ai_chat_summary 总行数:", r2.n);
    d.get("SELECT COUNT(*) AS n FROM ai_chat_session", (e3, r3) => {
      if (e3) throw e3;
      console.log("ai_chat_session 总行数:", r3.n);
      d.all("SELECT id, role, compressed, LENGTH(content) AS len FROM ai_chat ORDER BY id DESC LIMIT 8", [], (e4, rows) => {
        if (e4) throw e4;
        console.log("\n最近 8 条:");
        rows.forEach(x => console.log(`  id=${x.id} ${x.role} compressed=${x.compressed} len=${x.len}`));
        d.close();
      });
    });
  });
});
