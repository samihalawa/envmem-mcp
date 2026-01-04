import type { Env, EnvVariable, SearchResult, SearchOptions, AuthContext, Project, EnvProjectLink, EnvWithProject } from './types';

/**
 * Vector store using Cloudflare Vectorize and D1
 * Supports multi-tenant isolation via userId (when migration is applied)
 */
export class CloudflareVectorStore {
  private userId: string;
  private multiTenantEnabled: boolean = false;

  constructor(
    private env: Env,
    auth?: AuthContext
  ) {
    // Default to 'anonymous' for backward compatibility
    this.userId = auth?.userId || 'anonymous';
  }

  /**
   * Check if user_id column exists (lazy check, cached)
   */
  private async checkMultiTenant(): Promise<boolean> {
    if (this.multiTenantEnabled) return true;
    try {
      const result = await this.env.DB.prepare(
        "SELECT user_id FROM env_variables LIMIT 1"
      ).first();
      // If query succeeds (even with no results), column exists
      this.multiTenantEnabled = true;
      return true;
    } catch {
      // Column doesn't exist - running without multi-tenant
      return false;
    }
  }

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
   * Insert environment variable into D1 with synchronous embedding generation
   * (Modified from async queue pattern - queues require paid plan)
   */
  async insertEnvVariable(envVar: EnvVariable): Promise<{ id: number; indexed: boolean }> {
    const multiTenant = await this.checkMultiTenant();
    let result: { id: number } | null;

    if (multiTenant) {
      // Multi-tenant mode: insert with user_id
      result = await this.env.DB.prepare(`
        INSERT INTO env_variables (user_id, name, description, category, service, required, example, keywords, related_to)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(user_id, name) DO UPDATE SET
          description = excluded.description,
          category = excluded.category,
          service = excluded.service,
          required = excluded.required,
          example = excluded.example,
          keywords = excluded.keywords,
          related_to = excluded.related_to,
          updated_at = strftime('%s', 'now')
        RETURNING id
      `)
        .bind(
          this.userId,
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
    } else {
      // Legacy mode: insert without user_id
      result = await this.env.DB.prepare(`
        INSERT INTO env_variables (name, description, category, service, required, example, keywords, related_to)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          category = excluded.category,
          service = excluded.service,
          required = excluded.required,
          example = excluded.example,
          keywords = excluded.keywords,
          related_to = excluded.related_to,
          updated_at = strftime('%s', 'now')
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
    }

    if (!result) {
      throw new Error(`Failed to insert env variable: ${envVar.name}`);
    }

    // 2. Create indexing status record
    await this.env.DB.prepare(
      'INSERT INTO indexing_status (env_variable_id, status, queue_timestamp) VALUES (?, ?, ?)'
    ).bind(result.id, 'processing', Math.floor(Date.now() / 1000)).run();

    // 3. Generate embedding synchronously (no queue on free plan)
    try {
      const text = this.enrichText(envVar);
      const embedding = await this.generateEmbedding(text);

      // 4. Insert into Vectorize with userId for filtering
      const vectorId = `env-${this.userId}-${result.id}`;
      await this.env.VECTORIZE.insert([{
        id: vectorId,
        values: embedding,
        metadata: {
          userId: this.userId,
          envVariableId: result.id,
          name: envVar.name,
          indexedAt: Date.now(),
        },
      }]);

      // 5. Update env_variables with vector_id
      await this.env.DB.prepare(
        'UPDATE env_variables SET vector_id = ?, indexed_at = ? WHERE id = ?'
      ).bind(vectorId, Math.floor(Date.now() / 1000), result.id).run();

      // 6. Update indexing status
      await this.env.DB.prepare(
        'UPDATE indexing_status SET status = ?, indexed_timestamp = ? WHERE env_variable_id = ?'
      ).bind('indexed', Math.floor(Date.now() / 1000), result.id).run();

      console.log(`✅ Indexed: ${envVar.name} (vector: ${vectorId})`);
      return { id: result.id, indexed: true };
    } catch (error) {
      // Update status to failed
      await this.env.DB.prepare(
        'UPDATE indexing_status SET status = ?, error_message = ? WHERE env_variable_id = ?'
      ).bind('failed', error instanceof Error ? error.message : 'Unknown error', result.id).run();

      console.error(`❌ Failed to index ${envVar.name}:`, error);
      return { id: result.id, indexed: false };
    }
  }

  /**
   * Bulk insert environment variables (synchronous embedding)
   */
  async bulkInsert(envVars: EnvVariable[]): Promise<{ inserted: number; indexed: number }> {
    let inserted = 0;
    let indexed = 0;

    for (const envVar of envVars) {
      try {
        const result = await this.insertEnvVariable(envVar);
        inserted++;
        if (result.indexed) indexed++;
      } catch (error) {
        console.error(`Failed to insert ${envVar.name}:`, error);
      }
    }

    return { inserted, indexed };
  }

  /**
   * Get environment variable by ID (scoped to user when multi-tenant enabled)
   */
  async getById(id: number): Promise<EnvVariable | null> {
    const multiTenant = await this.checkMultiTenant();
    let row: any;

    if (multiTenant) {
      row = await this.env.DB.prepare(
        'SELECT * FROM env_variables WHERE id = ?1 AND user_id = ?2'
      ).bind(id, this.userId).first<any>();
    } else {
      row = await this.env.DB.prepare(
        'SELECT * FROM env_variables WHERE id = ?1'
      ).bind(id).first<any>();
    }

    return row ? this.rowToEnvVariable(row) : null;
  }

  /**
   * Search using semantic similarity (Vectorize)
   */
  private async semanticSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    try {
      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Search Vectorize with userId filter
      const vectorResults = await this.env.VECTORIZE.query(queryEmbedding, {
        topK: (options.limit || 10) * 2, // Get extra for filtering
        returnMetadata: 'all',
        filter: { userId: this.userId },
      });

      const results: SearchResult[] = [];

      for (const match of vectorResults.matches) {
        // Extract env variable ID from metadata or vector ID
        const envId = (match.metadata as any)?.envVariableId ||
          parseInt(match.id.replace('env-', ''));

        if (!envId || isNaN(envId)) continue;

        // Get full metadata from D1
        const envVar = await this.getById(envId);
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
    } catch (error) {
      console.error('Semantic search error:', error);
      return [];
    }
  }

  /**
   * Search using keyword matching (D1 FTS5)
   */
  private async keywordSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    try {
      const multiTenant = await this.checkMultiTenant();

      // Convert query to FTS5 format: "send email" -> "send OR email"
      const ftsQuery = query
        .split(/\s+/)
        .filter(word => word.length > 1)
        .map(word => `"${word}"`)
        .join(' OR ');

      if (!ftsQuery) return [];

      let sql: string;
      let params: any[];

      if (multiTenant) {
        sql = `
          SELECT ev.*, rank
          FROM env_fts
          JOIN env_variables ev ON env_fts.rowid = ev.id
          WHERE env_fts MATCH ?1 AND ev.user_id = ?2
        `;
        params = [ftsQuery, this.userId];
      } else {
        sql = `
          SELECT ev.*, rank
          FROM env_fts
          JOIN env_variables ev ON env_fts.rowid = ev.id
          WHERE env_fts MATCH ?1
        `;
        params = [ftsQuery];
      }

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
      params.push((options.limit || 10) * 2);

      const { results } = await this.env.DB.prepare(sql)
        .bind(...params)
        .all<any>();

      return results.map((row: any, i: number) => ({
        env: this.rowToEnvVariable(row),
        score: Math.max(0.1, 1.0 - (i / results.length)), // Normalize by position
        matchType: 'keyword' as const,
      }));
    } catch (error) {
      console.error('FTS search error, trying LIKE fallback:', error);
      return this.likeSearch(query, options);
    }
  }

  /**
   * Fallback LIKE search when FTS fails
   */
  private async likeSearch(
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const multiTenant = await this.checkMultiTenant();
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) return [];

    // Build LIKE conditions for each word - offset param indices based on mode
    const paramOffset = multiTenant ? 2 : 1;
    const conditions = words.map((_, i) =>
      `(LOWER(name) LIKE ?${i + paramOffset} OR LOWER(description) LIKE ?${i + paramOffset} OR LOWER(service) LIKE ?${i + paramOffset} OR LOWER(keywords) LIKE ?${i + paramOffset})`
    ).join(' OR ');

    let sql: string;
    let params: any[];

    if (multiTenant) {
      sql = `SELECT * FROM env_variables WHERE user_id = ?1 AND (${conditions})`;
      params = [this.userId, ...words.map(w => `%${w}%`)];
    } else {
      sql = `SELECT * FROM env_variables WHERE (${conditions})`;
      params = [...words.map(w => `%${w}%`)];
    }

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
    params.push(options.limit || 10);

    const { results } = await this.env.DB.prepare(sql)
      .bind(...params)
      .all<any>();

    return results.map((row: any, i: number) => ({
      env: this.rowToEnvVariable(row),
      score: Math.max(0.1, 1.0 - (i / Math.max(results.length, 1))),
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
   * Get environment variables by service name (scoped to user when multi-tenant enabled)
   */
  async getByService(service: string, includeOptional: boolean = true): Promise<EnvVariable[]> {
    const multiTenant = await this.checkMultiTenant();
    let sql: string;
    let params: any[];

    if (multiTenant) {
      sql = 'SELECT * FROM env_variables WHERE user_id = ? AND LOWER(service) = LOWER(?)';
      params = [this.userId, service];
    } else {
      sql = 'SELECT * FROM env_variables WHERE LOWER(service) = LOWER(?)';
      params = [service];
    }

    if (!includeOptional) {
      sql += ' AND required = 1';
    }
    const { results } = await this.env.DB.prepare(sql)
      .bind(...params)
      .all<any>();

    return results.map(this.rowToEnvVariable);
  }

  /**
   * Get environment variable by name (scoped to user when multi-tenant enabled)
   */
  async getByName(name: string): Promise<EnvVariable | null> {
    const multiTenant = await this.checkMultiTenant();
    let row: any;

    if (multiTenant) {
      row = await this.env.DB.prepare(
        'SELECT * FROM env_variables WHERE user_id = ?1 AND name = ?2'
      ).bind(this.userId, name).first<any>();
    } else {
      row = await this.env.DB.prepare(
        'SELECT * FROM env_variables WHERE name = ?1'
      ).bind(name).first<any>();
    }

    return row ? this.rowToEnvVariable(row) : null;
  }

  /**
   * Get all environment variables (scoped to user when multi-tenant enabled)
   */
  async getAll(options: SearchOptions = {}): Promise<EnvVariable[]> {
    const multiTenant = await this.checkMultiTenant();
    let sql: string;
    let params: any[];

    if (multiTenant) {
      sql = 'SELECT * FROM env_variables WHERE user_id = ?';
      params = [this.userId];
    } else {
      sql = 'SELECT * FROM env_variables WHERE 1=1';
      params = [];
    }

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
   * Debug info for troubleshooting multi-tenant
   */
  async getDebugInfo() {
    const multiTenant = await this.checkMultiTenant();

    // Count records with different user_ids
    const userCounts = await this.env.DB.prepare(
      'SELECT user_id, COUNT(*) as count FROM env_variables GROUP BY user_id'
    ).all<{ user_id: string; count: number }>();

    return {
      multiTenantEnabled: multiTenant,
      currentUserId: this.userId,
      userCounts: userCounts.results,
    };
  }

  /**
   * Get statistics (scoped to user when multi-tenant enabled)
   */
  async getStats() {
    const multiTenant = await this.checkMultiTenant();

    let total: { count: number } | null;
    let required: { count: number } | null;
    let byCategory: { results: { category: string; count: number }[] };
    let byService: { results: { service: string; count: number }[] };

    if (multiTenant) {
      total = await this.env.DB.prepare(
        'SELECT COUNT(*) as count FROM env_variables WHERE user_id = ?'
      ).bind(this.userId).first<{ count: number }>();

      required = await this.env.DB.prepare(
        'SELECT COUNT(*) as count FROM env_variables WHERE user_id = ? AND required = 1'
      ).bind(this.userId).first<{ count: number }>();

      byCategory = await this.env.DB.prepare(
        'SELECT category, COUNT(*) as count FROM env_variables WHERE user_id = ? GROUP BY category'
      ).bind(this.userId).all<{ category: string; count: number }>();

      byService = await this.env.DB.prepare(
        'SELECT service, COUNT(*) as count FROM env_variables WHERE user_id = ? GROUP BY service'
      ).bind(this.userId).all<{ service: string; count: number }>();
    } else {
      total = await this.env.DB.prepare(
        'SELECT COUNT(*) as count FROM env_variables'
      ).first<{ count: number }>();

      required = await this.env.DB.prepare(
        'SELECT COUNT(*) as count FROM env_variables WHERE required = 1'
      ).first<{ count: number }>();

      byCategory = await this.env.DB.prepare(
        'SELECT category, COUNT(*) as count FROM env_variables GROUP BY category'
      ).all<{ category: string; count: number }>();

      byService = await this.env.DB.prepare(
        'SELECT service, COUNT(*) as count FROM env_variables GROUP BY service'
      ).all<{ service: string; count: number }>();
    }

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
      userId: row.user_id || 'anonymous', // Handle legacy rows without user_id
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

  /**
   * Delete environment variable by name (scoped to user when multi-tenant enabled)
   */
  async deleteByName(name: string): Promise<boolean> {
    const multiTenant = await this.checkMultiTenant();
    let row: { id: number; vector_id: string | null } | null;

    // Get the env var first to get vector_id
    if (multiTenant) {
      row = await this.env.DB.prepare(
        'SELECT id, vector_id FROM env_variables WHERE user_id = ? AND name = ?'
      ).bind(this.userId, name).first<{ id: number; vector_id: string | null }>();
    } else {
      row = await this.env.DB.prepare(
        'SELECT id, vector_id FROM env_variables WHERE name = ?'
      ).bind(name).first<{ id: number; vector_id: string | null }>();
    }

    if (!row) return false;

    // Delete from Vectorize if indexed
    if (row.vector_id) {
      try {
        await this.env.VECTORIZE.deleteByIds([row.vector_id]);
      } catch (error) {
        console.error(`Failed to delete vector ${row.vector_id}:`, error);
      }
    }

    // Delete from indexing_status
    await this.env.DB.prepare(
      'DELETE FROM indexing_status WHERE env_variable_id = ?'
    ).bind(row.id).run();

    // Delete from env_variables
    await this.env.DB.prepare(
      'DELETE FROM env_variables WHERE id = ?'
    ).bind(row.id).run();

    return true;
  }

  /**
   * Delete all environment variables (scoped to user when multi-tenant enabled)
   */
  async deleteAll(): Promise<{ deleted: number }> {
    const multiTenant = await this.checkMultiTenant();

    // Get all vector IDs (scoped by user when multi-tenant)
    let envResults: { results: { id: number; vector_id: string }[] };

    if (multiTenant) {
      envResults = await this.env.DB.prepare(
        'SELECT id, vector_id FROM env_variables WHERE user_id = ? AND vector_id IS NOT NULL'
      ).bind(this.userId).all<{ id: number; vector_id: string }>();
    } else {
      envResults = await this.env.DB.prepare(
        'SELECT id, vector_id FROM env_variables WHERE vector_id IS NOT NULL'
      ).all<{ id: number; vector_id: string }>();
    }

    const vectorIds = envResults.results.map(r => r.vector_id).filter(Boolean);

    // Delete from Vectorize in batches
    if (vectorIds.length > 0) {
      try {
        // Vectorize deleteByIds has a limit, batch if needed
        const batchSize = 100;
        for (let i = 0; i < vectorIds.length; i += batchSize) {
          const batch = vectorIds.slice(i, i + batchSize);
          await this.env.VECTORIZE.deleteByIds(batch);
        }
      } catch (error) {
        console.error('Failed to delete vectors:', error);
      }
    }

    // Get IDs to delete indexing_status
    const envIds = envResults.results.map(r => r.id);

    // Delete from indexing_status for env vars
    if (envIds.length > 0) {
      for (const id of envIds) {
        await this.env.DB.prepare('DELETE FROM indexing_status WHERE env_variable_id = ?').bind(id).run();
      }
    }

    // Delete env_variables (scoped by user when multi-tenant)
    let result: any;
    if (multiTenant) {
      result = await this.env.DB.prepare('DELETE FROM env_variables WHERE user_id = ?').bind(this.userId).run();
    } else {
      result = await this.env.DB.prepare('DELETE FROM env_variables').run();
    }

    return { deleted: result.meta.changes || 0 };
  }

  /**
   * Parse .env format text into EnvVariable objects
   * Handles comments and multi-line values
   */
  parseEnvText(text: string): Partial<EnvVariable>[] {
    const envVars: Partial<EnvVariable>[] = [];
    const lines = text.split('\n');

    let currentCategory = 'other';
    let currentDescription = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        currentDescription = '';
        continue;
      }

      // Category header: # ======= CATEGORY =======
      if (trimmed.startsWith('#') && trimmed.includes('=====')) {
        const match = trimmed.match(/#+\s*=+\s*(.+?)\s*=+/);
        if (match) {
          currentCategory = this.inferCategory(match[1]);
        }
        continue;
      }

      // Description comment: # Some description
      if (trimmed.startsWith('#')) {
        currentDescription = trimmed.replace(/^#+\s*/, '');
        continue;
      }

      // Environment variable: NAME=value
      const envMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (envMatch) {
        const [, name, value] = envMatch;

        envVars.push({
          name,
          description: currentDescription || `${name} environment variable`,
          category: currentCategory as EnvVariable['category'],
          service: this.inferService(name),
          required: false,
          example: this.sanitizeExample(value),
          keywords: this.generateKeywords(name, currentDescription),
          relatedTo: [],
        });

        currentDescription = '';
      }
    }

    return envVars;
  }

  /**
   * Infer category from header text
   */
  private inferCategory(header: string): EnvVariable['category'] {
    const lower = header.toLowerCase();
    if (lower.includes('ai') || lower.includes('llm')) return 'ai_services';
    if (lower.includes('database') || lower.includes('db')) return 'database';
    if (lower.includes('email') || lower.includes('smtp')) return 'email';
    if (lower.includes('payment') || lower.includes('stripe')) return 'payment';
    if (lower.includes('auth')) return 'auth';
    if (lower.includes('deploy') || lower.includes('cloud') || lower.includes('hosting')) return 'deployment';
    if (lower.includes('storage') || lower.includes('cdn')) return 'storage';
    if (lower.includes('sms') || lower.includes('messaging') || lower.includes('twilio')) return 'sms';
    if (lower.includes('social')) return 'social';
    if (lower.includes('analytics')) return 'analytics';
    if (lower.includes('cms')) return 'cms';
    if (lower.includes('browser') || lower.includes('automation')) return 'browser_automation';
    if (lower.includes('monitor')) return 'monitoring';
    return 'other';
  }

  /**
   * Infer service from variable name
   */
  private inferService(name: string): string {
    const lower = name.toLowerCase();

    // Common patterns
    const servicePatterns: [RegExp, string][] = [
      [/^openai/i, 'OpenAI'],
      [/^gemini/i, 'Google Gemini'],
      [/^claude|^anthropic/i, 'Anthropic'],
      [/^stripe/i, 'Stripe'],
      [/^supabase/i, 'Supabase'],
      [/^cloudflare/i, 'Cloudflare'],
      [/^twilio/i, 'Twilio'],
      [/^sendgrid/i, 'SendGrid'],
      [/^mailjet/i, 'Mailjet'],
      [/^github/i, 'GitHub'],
      [/^gitlab/i, 'GitLab'],
      [/^docker/i, 'Docker'],
      [/^aws/i, 'AWS'],
      [/^gcp|^google/i, 'Google Cloud'],
      [/^azure/i, 'Azure'],
      [/^vercel/i, 'Vercel'],
      [/^netlify/i, 'Netlify'],
      [/^railway/i, 'Railway'],
      [/^redis/i, 'Redis'],
      [/^postgres/i, 'PostgreSQL'],
      [/^mysql/i, 'MySQL'],
      [/^mongo/i, 'MongoDB'],
      [/^neon/i, 'Neon'],
      [/^clerk/i, 'Clerk'],
      [/^auth0/i, 'Auth0'],
      [/^firebase/i, 'Firebase'],
      [/^brevo|^sendinblue/i, 'Brevo'],
      [/^smtp/i, 'SMTP'],
      [/^imap/i, 'IMAP'],
      [/^sumup/i, 'SumUp'],
      [/^pinecone/i, 'Pinecone'],
      [/^minio/i, 'MinIO'],
      [/^digitalocean/i, 'DigitalOcean'],
      [/^coolify/i, 'Coolify'],
      [/^mistral/i, 'Mistral'],
      [/^hugging|^hf_/i, 'Hugging Face'],
    ];

    for (const [pattern, service] of servicePatterns) {
      if (pattern.test(name)) return service;
    }

    // Extract first word as service name
    const firstPart = name.split('_')[0];
    return firstPart.charAt(0).toUpperCase() + firstPart.slice(1).toLowerCase();
  }

  /**
   * Sanitize example value (hide actual secrets)
   */
  private sanitizeExample(value: string): string {
    // Return full value - this is a personal env reference, user needs actual secrets
    return value;
  }

  /**
   * Generate keywords from name and description
   */
  private generateKeywords(name: string, description: string): string[] {
    const words = new Set<string>();

    // Add name parts
    name.toLowerCase().split('_').forEach(w => {
      if (w.length > 2) words.add(w);
    });

    // Add description words
    description.toLowerCase().split(/\W+/).forEach(w => {
      if (w.length > 3) words.add(w);
    });

    return Array.from(words).slice(0, 10);
  }

  // ==================== PROJECT MANAGEMENT ====================

  /**
   * Check if projects table exists
   */
  private async checkProjectsEnabled(): Promise<boolean> {
    try {
      await this.env.DB.prepare("SELECT id FROM projects LIMIT 1").first();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create or update a project
   */
  async createProject(project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ id: number }> {
    const result = await this.env.DB.prepare(`
      INSERT INTO projects (user_id, name, repo_url, tags, description)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(user_id, name) DO UPDATE SET
        repo_url = excluded.repo_url,
        tags = excluded.tags,
        description = excluded.description,
        updated_at = strftime('%s', 'now')
      RETURNING id
    `).bind(
      this.userId,
      project.name,
      project.repoUrl || null,
      JSON.stringify(project.tags || []),
      project.description || null
    ).first<{ id: number }>();

    if (!result) throw new Error('Failed to create project');
    return { id: result.id };
  }

  /**
   * Get project by name
   */
  async getProjectByName(name: string): Promise<Project | null> {
    const row = await this.env.DB.prepare(
      'SELECT * FROM projects WHERE user_id = ? AND name = ?'
    ).bind(this.userId, name).first<any>();

    return row ? this.rowToProject(row) : null;
  }

  /**
   * Get project by repo URL
   */
  async getProjectByRepo(repoUrl: string): Promise<Project | null> {
    const row = await this.env.DB.prepare(
      'SELECT * FROM projects WHERE user_id = ? AND repo_url = ?'
    ).bind(this.userId, repoUrl).first<any>();

    return row ? this.rowToProject(row) : null;
  }

  /**
   * List all projects for user
   */
  async listProjects(): Promise<Project[]> {
    const { results } = await this.env.DB.prepare(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY name'
    ).bind(this.userId).all<any>();

    return results.map(this.rowToProject);
  }

  /**
   * Link an env variable to a project with optional environment
   */
  async linkEnvToProject(
    envName: string,
    projectName: string,
    environment: EnvProjectLink['environment'] = 'default',
    valueOverride?: string
  ): Promise<{ success: boolean; linkId?: number }> {
    // Get env variable
    const envVar = await this.getByName(envName);
    if (!envVar?.id) return { success: false };

    // Get or create project
    let project = await this.getProjectByName(projectName);
    if (!project) {
      const { id } = await this.createProject({ name: projectName, tags: [], userId: this.userId });
      project = { id, name: projectName, tags: [], userId: this.userId };
    }

    // Create link
    const result = await this.env.DB.prepare(`
      INSERT INTO env_project_links (env_variable_id, project_id, environment, value_override)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(env_variable_id, project_id, environment) DO UPDATE SET
        value_override = excluded.value_override
      RETURNING id
    `).bind(
      envVar.id,
      project.id,
      environment,
      valueOverride || null
    ).first<{ id: number }>();

    return { success: !!result, linkId: result?.id };
  }

  /**
   * Get all env variables for a project, optionally filtered by environment
   */
  async getEnvsForProject(
    projectName: string,
    environment?: EnvProjectLink['environment']
  ): Promise<EnvWithProject[]> {
    const project = await this.getProjectByName(projectName);
    if (!project?.id) return [];

    let sql = `
      SELECT ev.*, epl.environment, epl.value_override
      FROM env_variables ev
      JOIN env_project_links epl ON ev.id = epl.env_variable_id
      WHERE epl.project_id = ? AND ev.user_id = ?
    `;
    const params: any[] = [project.id, this.userId];

    if (environment) {
      sql += ' AND epl.environment = ?';
      params.push(environment);
    }

    sql += ' ORDER BY ev.service, ev.name';

    const { results } = await this.env.DB.prepare(sql).bind(...params).all<any>();

    return results.map(row => ({
      ...this.rowToEnvVariable(row),
      projectName,
      environment: row.environment,
      valueOverride: row.value_override,
    }));
  }

  /**
   * Generate a complete .env file for a project
   */
  async generateEnvFile(
    projectName: string,
    environment: EnvProjectLink['environment'] = 'default',
    includeComments: boolean = true
  ): Promise<string> {
    const envs = await this.getEnvsForProject(projectName, environment);

    if (envs.length === 0) {
      // Try to get envs for default environment if specific env has none
      if (environment !== 'default') {
        const defaultEnvs = await this.getEnvsForProject(projectName, 'default');
        if (defaultEnvs.length > 0) {
          return this.formatEnvFile(defaultEnvs, projectName, environment, includeComments);
        }
      }
      return `# No environment variables found for project: ${projectName}\n# Use link_env_to_project to add envs to this project\n`;
    }

    return this.formatEnvFile(envs, projectName, environment, includeComments);
  }

  /**
   * Format env variables as .env file content
   */
  private formatEnvFile(
    envs: EnvWithProject[],
    projectName: string,
    environment: string,
    includeComments: boolean
  ): string {
    let output = '';

    if (includeComments) {
      output += `# ================================================\n`;
      output += `# ${projectName} - ${environment} environment\n`;
      output += `# Generated by EnvMem at ${new Date().toISOString()}\n`;
      output += `# ================================================\n\n`;
    }

    // Group by service
    const byService = new Map<string, EnvWithProject[]>();
    for (const env of envs) {
      const service = env.service || 'Other';
      if (!byService.has(service)) byService.set(service, []);
      byService.get(service)!.push(env);
    }

    for (const [service, serviceEnvs] of byService) {
      if (includeComments) {
        output += `# ======= ${service} =======\n`;
      }

      for (const env of serviceEnvs) {
        if (includeComments && env.description) {
          output += `# ${env.description}\n`;
        }
        // Use value override if present, otherwise use example
        const value = env.valueOverride || env.example || '';
        const prefix = env.required ? '' : '# ';
        output += `${prefix}${env.name}=${value}\n`;
      }
      output += '\n';
    }

    return output;
  }

  /**
   * Parse .env.example and match with stored env variables
   */
  async matchEnvExample(
    envExampleText: string,
    projectName: string
  ): Promise<{ matched: EnvVariable[]; missing: string[]; template: string }> {
    // Parse the .env.example to get variable names
    const lines = envExampleText.split('\n');
    const varNames: string[] = [];

    for (const line of lines) {
      const match = line.trim().match(/^([A-Z][A-Z0-9_]*)=/);
      if (match) varNames.push(match[1]);
    }

    const matched: EnvVariable[] = [];
    const missing: string[] = [];

    // Try to find each variable in the store
    for (const name of varNames) {
      const envVar = await this.getByName(name);
      if (envVar) {
        matched.push(envVar);
        // Auto-link to project
        await this.linkEnvToProject(name, projectName, 'default');
      } else {
        missing.push(name);
      }
    }

    // Generate template with filled values
    let template = '';
    for (const line of lines) {
      const match = line.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)/);
      if (match) {
        const [, name, originalValue] = match;
        const envVar = matched.find(e => e.name === name);
        if (envVar?.example) {
          template += `${name}=${envVar.example}\n`;
        } else {
          template += `${name}=${originalValue}\n`;
        }
      } else {
        template += line + '\n';
      }
    }

    return { matched, missing, template };
  }

  /**
   * Bulk link envs to project by service names
   */
  async linkServiceEnvsToProject(
    projectName: string,
    services: string[],
    environment: EnvProjectLink['environment'] = 'default'
  ): Promise<{ linked: number; services: Record<string, number> }> {
    let totalLinked = 0;
    const serviceStats: Record<string, number> = {};

    for (const service of services) {
      const envVars = await this.getByService(service, true);
      serviceStats[service] = 0;

      for (const env of envVars) {
        const result = await this.linkEnvToProject(env.name, projectName, environment);
        if (result.success) {
          totalLinked++;
          serviceStats[service]++;
        }
      }
    }

    return { linked: totalLinked, services: serviceStats };
  }

  /**
   * Delete project and all its links
   */
  async deleteProject(projectName: string): Promise<boolean> {
    const project = await this.getProjectByName(projectName);
    if (!project?.id) return false;

    // Delete links first
    await this.env.DB.prepare(
      'DELETE FROM env_project_links WHERE project_id = ?'
    ).bind(project.id).run();

    // Delete project
    await this.env.DB.prepare(
      'DELETE FROM projects WHERE id = ?'
    ).bind(project.id).run();

    return true;
  }

  /**
   * Convert row to Project
   */
  private rowToProject(row: any): Project {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      repoUrl: row.repo_url,
      tags: row.tags ? JSON.parse(row.tags) : [],
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
