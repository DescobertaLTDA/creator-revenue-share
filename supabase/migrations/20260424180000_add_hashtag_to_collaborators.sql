-- Adiciona coluna hashtag aos colaboradores
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS hashtag TEXT;

-- Índice único case-insensitive na hashtag (sem o #)
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaborators_hashtag
  ON public.collaborators (LOWER(hashtag))
  WHERE hashtag IS NOT NULL;
