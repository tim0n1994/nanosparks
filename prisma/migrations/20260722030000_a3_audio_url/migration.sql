-- Phase A3: store the enclosure/platform audio URL on GlobalEpisode so the
-- reader's inline player plays the original audio (not the page backlink URL).
ALTER TABLE "GlobalEpisode" ADD COLUMN "audioUrl" TEXT;
