import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const channel = await prisma.channel.upsert({
    where: { youtubeId: 'UCZrYJYFeHnPJKX-FkrB1q2Q' },
    update: {},
    create: {
      youtubeId: 'UCZrYJYFeHnPJKX-FkrB1q2Q',
      title: 'Demo Podcast',
      description: 'A demo podcast channel for testing.',
    },
  });

  const episode = await prisma.episode.upsert({
    where: { youtubeId: 'dQw4w9WgXcQ' },
    update: {},
    create: {
      youtubeId: 'dQw4w9WgXcQ',
      title: 'The Future of AI Safety: A Debate',
      description: 'Three experts debate the most pressing challenges in AI alignment and safety.',
      duration: 5400,
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
      channelId: channel.id,
      status: 'COMPLETED',
      transcript: [
        { start: 0, end: 5, text: 'Welcome to the debate on AI safety.' },
        { start: 120, end: 130, text: 'AI alignment is the most critical challenge of our century.' },
        { start: 180, end: 190, text: 'Current RLHF methods are insufficient for superintelligence.' },
        { start: 400, end: 410, text: 'Open-source AI accelerates safety research.' },
      ],
    },
  });

  const analysisData = await prisma.analysis.upsert({
    where: { episodeId: episode.id },
    update: {},
    create: {
      episodeId: episode.id,
      arguments: [
        { id: 'a1', text: 'AI alignment is the most critical challenge of our century', speakerId: 's1', type: 'claim', timestamp: 120 },
        { id: 'a2', text: 'Current RLHF methods are insufficient for superintelligence', speakerId: 's2', type: 'oppose', timestamp: 180, parentId: 'a1' },
        { id: 'a3', text: 'We need mechanistic interpretability as a foundation', speakerId: 's1', type: 'support', timestamp: 240, parentId: 'a1' },
        { id: 'a4', text: 'Open-source AI accelerates safety research', speakerId: 's3', type: 'claim', timestamp: 400 },
        { id: 'a5', text: 'Open models can be fine-tuned for harmful purposes', speakerId: 's2', type: 'oppose', timestamp: 480, parentId: 'a4' },
      ],
      speakers: [
        { id: 's1', name: 'Dr. Sarah Chen', role: 'expert' },
        { id: 's2', name: 'Prof. Marcus Webb', role: 'expert' },
        { id: 's3', name: 'Alex Rivera', role: 'guest' },
      ],
      topics: [
        { id: 't1', name: 'AI Alignment', mentionCount: 12, sentiment: 'neutral', timestamps: [120, 180, 240] },
        { id: 't2', name: 'Open Source', mentionCount: 8, sentiment: 'positive', timestamps: [400, 480] },
        { id: 't3', name: 'Interpretability', mentionCount: 5, sentiment: 'neutral', timestamps: [240] },
        { id: 't4', name: 'RLHF', mentionCount: 4, sentiment: 'negative', timestamps: [180] },
        { id: 't5', name: 'Superintelligence', mentionCount: 6, sentiment: 'negative', timestamps: [180, 240] },
      ],
      quotes: [
        { id: 'q1', text: 'If we solve alignment, everything else is manageable.', speakerId: 's1', timestamp: 125, context: 'Opening statement' },
        { id: 'q2', text: 'RLHF is basically teaching a parrot to say what humans want to hear.', speakerId: 's2', timestamp: 185, context: 'Critique of RLHF' },
        { id: 'q3', text: 'The open-source community has found more vulnerabilities than any red team.', speakerId: 's3', timestamp: 410, context: 'Defense of open-source' },
        { id: 'q4', text: 'Mechanistic interpretability is our microscope into the black box.', speakerId: 's1', timestamp: 245, context: 'On interpretability' },
      ],
    },
  });

  const refs = [
    { url: 'https://arxiv.org/abs/2209.00626', title: 'Constitutional AI: Harmlessness from AI Feedback', description: 'Anthropic paper on RLHF alternatives', relevanceScore: 0.95 },
    { url: 'https://www.alignmentforum.org/', title: 'AI Alignment Forum', description: 'Community hub for alignment research', relevanceScore: 0.92 },
    { url: 'https://distill.pub/2020/circuits/', title: 'Circuits: Distill Publication', description: 'Mechanistic interpretability research', relevanceScore: 0.88 },
    { url: 'https://openai.com/research/gpt-4', title: 'GPT-4 Technical Report', description: 'OpenAI paper on GPT-4 capabilities and safety', relevanceScore: 0.85 },
    { url: 'https://www.lesswrong.com/', title: 'LessWrong', description: 'Rationality and AI safety discussion', relevanceScore: 0.78 },
    { url: 'https://huggingface.co/', title: 'Hugging Face', description: 'Open-source ML platform', relevanceScore: 0.72 },
  ];

  for (const ref of refs) {
    await prisma.referenceLink.upsert({
      where: { id: `r-${ref.url}` },
      update: {},
      create: { ...ref, id: `r-${ref.url}`, analysisId: analysisData.id },
    });
  }

  const playlist = await prisma.playlist.upsert({
    where: { shareId: 'demo-share-123' },
    update: {},
    create: {
      name: 'AI Safety Debates',
      description: 'Deep dives into AI alignment and safety from leading researchers.',
      userId: 'demo-user',
      shareId: 'demo-share-123',
    },
  });

  await prisma.playlistEpisode.upsert({
    where: { playlistId_episodeId: { playlistId: playlist.id, episodeId: episode.id } },
    update: {},
    create: { playlistId: playlist.id, episodeId: episode.id, order: 0 },
  });

  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
