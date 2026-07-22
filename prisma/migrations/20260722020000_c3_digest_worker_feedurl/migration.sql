-- Phase C3: digest worker. Adds Source.feedUrl (RSS polling target) and
-- GlobalEpisode.lastPolledAt (scheduling visibility for followed shows).

ALTER TABLE "Source" ADD COLUMN "feedUrl" TEXT;

ALTER TABLE "GlobalEpisode" ADD COLUMN "lastPolledAt" TIMESTAMP(3);
