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
WHERE id = ${id}
LIMIT 1;
