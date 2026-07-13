-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'TRANSCRIBING', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "channelId" TEXT NOT NULL,
    "transcript" JSONB,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "speakers" JSONB NOT NULL,
    "topics" JSONB NOT NULL,
    "quotes" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceLink" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "shareId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistEpisode" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_youtubeId_key" ON "Channel"("youtubeId");

-- CreateIndex
CREATE INDEX "Channel_youtubeId_idx" ON "Channel"("youtubeId");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_youtubeId_key" ON "Episode"("youtubeId");

-- CreateIndex
CREATE INDEX "Episode_channelId_idx" ON "Episode"("channelId");

-- CreateIndex
CREATE INDEX "Episode_status_idx" ON "Episode"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_episodeId_key" ON "Analysis"("episodeId");

-- CreateIndex
CREATE INDEX "ReferenceLink_analysisId_idx" ON "ReferenceLink"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_shareId_key" ON "Playlist"("shareId");

-- CreateIndex
CREATE INDEX "Playlist_userId_idx" ON "Playlist"("userId");

-- CreateIndex
CREATE INDEX "Playlist_shareId_idx" ON "Playlist"("shareId");

-- CreateIndex
CREATE INDEX "PlaylistEpisode_playlistId_idx" ON "PlaylistEpisode"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistEpisode_episodeId_idx" ON "PlaylistEpisode"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistEpisode_playlistId_episodeId_key" ON "PlaylistEpisode"("playlistId", "episodeId");

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistEpisode" ADD CONSTRAINT "PlaylistEpisode_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistEpisode" ADD CONSTRAINT "PlaylistEpisode_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
