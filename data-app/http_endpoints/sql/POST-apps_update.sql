USE qnote_catalog;

UPDATE qnote_catalog.published_app
SET name = ${name},
    description = ${description},
    author = ${author},
    manifest = ${manifest},
    repo_url = ${repo_url},
    tags = ${tags},
    updated_at = ${updated_at}
WHERE id = ${id};
