'use client';

import { useEffect, useRef } from 'react';

export default function ApiDocsPage() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    document.title = 'NanoSparks API Docs — Swagger UI';

    const style = document.createElement('style');
    style.textContent = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .swagger-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 16px; }
      .swagger-spinner { width: 40px; height: 40px; border: 3px solid #e0e0e0; border-top-color: #7c3aed; border-radius: 50%; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .swagger-loading h2 { font-size: 18px; font-weight: 500; color: #555; }
      .swagger-loading p { font-size: 13px; color: #888; }
    `;
    document.head.appendChild(style);

    const swaggerCss = document.createElement('link');
    swaggerCss.rel = 'stylesheet';
    swaggerCss.href = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';
    document.head.appendChild(swaggerCss);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';
    script.onload = () => {
      (window as unknown as { SwaggerUIBundle: (opts: Record<string, unknown>) => void }).SwaggerUIBundle({
        url: '/api/docs',
        dom_id: '#swagger-ui',
        presets: [
          (window as unknown as { SwaggerUIBundle: { presets: { apis: unknown } } }).SwaggerUIBundle.presets.apis,
          (window as unknown as { SwaggerUIBundle: { SwaggerUIStandalonePreset: unknown } }).SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: 'StandaloneLayout',
        deepLinking: true,
        defaultModelsExpandDepth: 3,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
      });
    };
    document.body.appendChild(script);
  }, []);

  return (
    <div id="swagger-ui">
      <div className="swagger-loading">
        <div className="swagger-spinner" />
        <h2>Loading API Documentation…</h2>
        <p>NanoSparks — Phase 4 (PII / Embeddings / Semantic Search)</p>
      </div>
    </div>
  );
}
