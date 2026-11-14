SELECT category, title, content, updated_at
FROM portfolio
WHERE is_active = TRUE
  AND (category <> 'status' OR (content <> '' AND NOT EXISTS (
        SELECT 1 FROM unnest(tags) AS t
        WHERE t LIKE 'expires:%' AND substring(t from 9)::timestamptz <= NOW())))
ORDER BY category, title;
