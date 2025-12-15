import type { Env, EnvVariable, SearchResult, SearchOptions } from './types';

/**
 * Vector store using Cloudflare Vectorize and D1
 */
export class CloudflareVectorStore {
  constructor(
    private env: Env
  ) {}

  /**
   * Generate embedding using Cloudflare Workers AI
   * Model: @cf/baai/bge-base-en-v1.5 (768 dimensions)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [text],
    }) as { data: number[][] };

    return response.data[0];
  }

  /**
   * Enrich text for better semantic matching
   */
  private enrichText(envVar: Partial<EnvVariable>): string {
    return [
      envVar.name?.replace(/_/g, ' '),
      envVar.description,
      envVar.category?.replace(/_/g, ' '),
      envVar.service,
      ...(envVar.keywords || []),
    ]
      .filter(Boolean)
      .join('. ');
  }

  /**
   * Insert environment variable into D1 and queue for async embedding
   * Pattern from: github.com/Foundation42/engram
   */
  async insertEnvVariable(envVar: EnvVariable): Promise<{ id: number; queued: boolean }> {
    // 1. Insert into D1 (metadata)
    const result = await this.env.DB.prepare(`
      INSERT INTO env_variables (name, description, category, service, required, example, keywords, related_to)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      RETURNING id
    `)
      .bind(
        envVar.name,
        envVar.description,
        envVar.category,
        envVar.service,
        envVar.required ? 1 : 0,
        envVar.example || null,
        JSON.stringify(envVar.keywords),
        JSON.stringify(envVar.relatedTo)
      )
      .first<{ id: number }>();

    if (!result) {
      throw new Error(`Failed to insert env variable: ${envVar.name}`);
    }

    // 2. Create indexing status record
    await this.env.DB.prepare(
      'INSERT INTO indexing_status (env_variable_id, status, queue_timestamp) VALUES (?, ?, ?)'
    ).bind(result.id, 'queued', Math.floor(Date.now() / 1000)).run();

    // 3. Queue for async embedding generation
    const text = this.enrichText(envVar);
    await this.env.QUEUE.send({
      envVariableId: result.id,
      name: envVar.name,
      text,
    });

    console.log(`✅ Queued: ${envVar.name} (id: ${result.id})`);

    return { id: result.id, queued: true };
  }

  /**
   * Bulk insert environment variables (async queue pattern)
   */
  async bulkInsert(envVars: EnvVariable[]): Promise<{ inserted: number; queued: number }> {
    let inserted = 0;
    let queued = 0;

    for (const envVar of envVars) {
      try {
        const result = await this.insertEnvVariable(envVar);
        inserted++;
        if (result.queued) queued++;
      } catch (error) {
        console.error(`Failed to insert ${envVar.name}:`, error);
      }
    }

    return { inserted, queued };
  }

  /**
   * Search using semantic similarity (Vectorize)
   */
  private async semanticSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Search Vectorize
    const vectorResults = await this.env.VECTORIZE.query(queryEmbedding, {
      topK: (options.limit || 10) * 2, // Get extra for filtering
      returnMetadata: true,
    });

    const results: SearchResult[] = [];

    for (const match of vectorResults.matches) {
      // Get full metadata from D1
      const envVar = await this.getByName(match.id);
      if (!envVar) continue;

      // Apply filters
      if (options.category && envVar.category !== options.category) continue;
      if (options.service && envVar.service !== options.service) continue;
      if (options.requiredOnly && !envVar.required) continue;
      if (options.minScore && match.score < options.minScore) continue;

      results.push({
        env: envVar,
        score: match.score,
        matchType: 'semantic',
      });

      if (results.length >= (options.limit || 10)) break;
    }

    return results;
  }

  /**
   * Search using keyword matching (D1 FTS5)
   */
  private async keywordSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    let sql = `
      SELECT ev.*, rank
      FROM env_fts
      JOIN env_variables ev ON env_fts.rowid = ev.id
      WHERE env_fts MATCH ?1
    `;

    const params: any[] = [query];

    if (options.category) {
      sql += ' AND ev.category = ?';
      params.push(options.category);
    }

    if (options.service) {
      sql += ' AND ev.service = ?';
      params.push(options.service);
    }

    if (options.requiredOnly) {
      sql += ' AND ev.required = 1';
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(options.limit || 10);

    const { results } = await this.env.DB.prepare(sql)
      .bind(...params)
      .all<any>();

    return results.map((row: any) => ({
      env: this.rowToEnvVariable(row),
      score: 1.0 - (row.rank / results.length), // Normalize rank to 0-1
      matchType: 'keyword' as const,
    }));
  }

  /**
   * Hybrid search: semantic + keyword with weighted scoring
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    // Run both searches in parallel
    const [semanticResults, keywordResults] = await Promise.all([
      this.semanticSearch(query, options),
      this.keywordSearch(query, options).catch(() => []), // FTS may fail for some queries
    ]);

    // Merge and re-rank
    const scoreMap = new Map<string, { env: EnvVariable; scores: number[] }>();

    // Add semantic scores (60% weight)
    for (const result of semanticResults) {
      scoreMap.set(result.env.name, {
        env: result.env,
        scores: [result.score * 0.6, 0],
      });
    }

    // Add keyword scores (30% weight)
    for (const result of keywordResults) {
      const existing = scoreMap.get(result.env.name);
      if (existing) {
        existing.scores[1] = result.score * 0.3;
      } else {
        scoreMap.set(result.env.name, {
          env: result.env,
          scores: [0, result.score * 0.3],
        });
      }
    }

    // Metadata boost (10% weight)
    for (const [name, data] of scoreMap) {
      let boost = 0;
      if (data.env.required) boost += 0.05;
      if (data.env.category === 'ai_services') boost += 0.05;
      data.scores.push(boost);
    }

    // Calculate final scores and sort
    const finalResults = Array.from(scoreMap.values())
      .map(({ env, scores }) => ({
        env,
        score: scores.reduce((a, b) => a + b, 0),
        matchType: 'hybrid' as const,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit || 10);

    return finalResults;
  }

  /**
   * Get environment variable by name
   */
  async getByName(name: string): Promise<EnvVariable | null> {
    const row = await this.env.DB.prepare(
      'SELECT * FROM env_variables WHERE name = ?1'
    )
      .bind(name)
      .first<any>();

    return row ? this.rowToEnvVariable(row) : null;
  }

  /**
   * Get all environment variables
   */
  async getAll(options: SearchOptions = {}): Promise<EnvVariable[]> {
    let sql = 'SELECT * FROM env_variables WHERE 1=1';
    const params: any[] = [];

    if (options.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }

    if (options.service) {
      sql += ' AND service = ?';
      params.push(options.service);
    }

    if (options.requiredOnly) {
      sql += ' AND required = 1';
    }

    sql += ' LIMIT ?';
    params.push(options.limit || 100);

    const { results } = await this.env.DB.prepare(sql)
      .bind(...params)
      .all<any>();

    return results.map(this.rowToEnvVariable);
  }

  /**
   * Get statistics
   */
  async getStats() {
    const total = await this.env.DB.prepare(
      'SELECT COUNT(*) as count FROM env_variables'
    ).first<{ count: number }>();

    const required = await this.env.DB.prepare(
      'SELECT COUNT(*) as count FROM env_variables WHERE required = 1'
    ).first<{ count: number }>();

    const byCategory = await this.env.DB.prepare(
      'SELECT category, COUNT(*) as count FROM env_variables GROUP BY category'
    ).all<{ category: string; count: number }>();

    const byService = await this.env.DB.prepare(
      'SELECT service, COUNT(*) as count FROM env_variables GROUP BY service'
    ).all<{ service: string; count: number }>();

    return {
      total: total?.count || 0,
      required: required?.count || 0,
      byCategory: Object.fromEntries(
        byCategory.results.map(r => [r.category, r.count])
      ),
      byService: Object.fromEntries(
        byService.results.map(r => [r.service, r.count])
      ),
    };
  }

  /**
   * Convert D1 row to EnvVariable
   */
  private rowToEnvVariable(row: any): EnvVariable {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      service: row.service,
      required: row.required === 1,
      example: row.example,
      keywords: row.keywords ? JSON.parse(row.keywords) : [],
      relatedTo: row.related_to ? JSON.parse(row.related_to) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
