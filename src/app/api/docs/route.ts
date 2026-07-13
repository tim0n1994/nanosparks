/**
 * GET /api/docs
 *
 * Returns the OpenAPI 3.0 specification for the NanoSparks API.
 * Visit /api/docs in a browser to view the spec JSON.
 * For a full Swagger UI experience, use the /docs page.
 */

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const specPath = path.join(process.cwd(), 'docs', 'openapi.yaml');
    const spec = await fs.readFile(specPath, 'utf-8');
    return new NextResponse(spec, {
      status: 200,
      headers: {
        'Content-Type': 'text/yaml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return NextResponse.json({ error: 'API spec not found' }, { status: 404 });
  }
}
