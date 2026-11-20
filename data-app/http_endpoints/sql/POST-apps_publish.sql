USE qnote_catalog;

INSERT INTO qnote_catalog.published_app
  (id, name, description, author, manifest, repo_url, tags, pulls, created_at, updated_at)
VALUES
  (${id}, ${name}, ${description}, ${author}, ${manifest}, ${repo_url}, ${tags}, ${pulls}, ${created_at}, ${updated_at});
