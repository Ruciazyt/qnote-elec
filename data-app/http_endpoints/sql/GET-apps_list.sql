USE qnote_catalog;

SELECT
  id,
  name,
  description,
  author,
  manifest,
  repo_url,
  tags,
  pulls,
  created_at,
  updated_at
FROM qnote_catalog.published_app
WHERE (
  ${keyword} = ''
  OR name LIKE CONCAT('%', ${keyword}, '%')
  OR description LIKE CONCAT('%', ${keyword}, '%')
  OR tags LIKE CONCAT('%', ${keyword}, '%')
  OR author LIKE CONCAT('%', ${keyword}, '%')
)
ORDER BY updated_at DESC
LIMIT ${limit} OFFSET ${offset};
