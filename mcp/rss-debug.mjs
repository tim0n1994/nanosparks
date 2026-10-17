const deadline = Date.now() + 20000;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10000);
try {
  const response = await fetch('https://podnews.net/rss', { redirect: 'manual', signal: controller.signal });
  console.log('status', response.status);
  console.log('location', response.headers.get('location'));
  if (response.ok) {
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      chunks.push(value);
    }
    console.log('bytes', size);
  }
} catch (error) {
  console.log('ERROR', error.name, error.message, error.cause?.code ?? error.cause?.message ?? '');
} finally { clearTimeout(timer); }
