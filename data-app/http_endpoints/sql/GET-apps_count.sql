USE qnote_catalog;

SELECT COUNT(*) AS n
FROM qnote_catalog.published_app
WHERE (
  ${keyword} = ''
  OR name LIKE CONCAT('%', ${keyword}, '%')
  OR description LIKE CONCAT('%', ${keyword}, '%')
  OR tags LIKE CONCAT('%', ${keyword}, '%')
  OR author LIKE CONCAT('%', ${keyword}, '%')
);
