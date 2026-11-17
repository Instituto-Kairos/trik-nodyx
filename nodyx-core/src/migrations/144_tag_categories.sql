-- Tags restritas a categorias. Uma tag SEM linhas aqui vale no fórum inteiro
-- (o comportamento de antes, então nada muda para as tags existentes); com
-- linhas, só pode ser usada — e só aparece — nas categorias listadas.

CREATE TABLE IF NOT EXISTS tag_categories (
  tag_id      UUID NOT NULL REFERENCES tags(id)       ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_categories_category ON tag_categories (category_id);
